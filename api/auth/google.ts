// Google OAuth API Endpoint for Vercel
// Handles Google Sign-In for login and signup
// Supports auto-linking Google to existing email accounts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { UserRepository } from '../../services/repositories/userRepository';
import { generateToken } from '../../services/auth/jwt';

interface GoogleUserInfo {
  id: string; // Google's user ID
  email: string;
  name: string;
  picture?: string;
}

/**
 * Verify Google ID token with Google's tokeninfo endpoint
 */
async function verifyGoogleToken(token: string): Promise<GoogleUserInfo | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
    };

    return {
      id: data.sub,
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { googleToken } = req.body;

    if (!googleToken) {
      return res.status(400).json({ error: 'Missing Google token' });
    }

    // Verify Google token and get user info
    const googleUserInfo = await verifyGoogleToken(googleToken);
    if (!googleUserInfo) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    // Scenario 1: Check if user exists by Google ID (existing Google user)
    let user = await UserRepository.findByGoogleId(googleUserInfo.id);

    if (user) {
      // Existing Google user - login
      const token = generateToken({ userId: user.id, email: user.email });

      return res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          profileImageUrl: user.profile_image_url,
          phoneNumber: user.phone_number,
          onboardingCompleted: user.onboarding_completed,
          hasGoogleLinked: true,
          hasPasswordSet: !!user.password_hash && user.password_hash !== '',
        },
      });
    }

    // Scenario 2: Check if email exists (potential auto-link scenario)
    user = await UserRepository.findByEmail(googleUserInfo.email);

    if (user) {
      // Email exists but not linked to Google - auto-link
      if (user.google_id) {
        // This shouldn't happen, but handle it
        return res.status(500).json({ error: 'Account configuration error' });
      }

      // Auto-link Google to existing account
      await UserRepository.linkGoogleAccount(user.id, googleUserInfo.id);

      // Update profile image if not set
      if (!user.profile_image_url && googleUserInfo.picture) {
        await UserRepository.updateProfile(user.id, {
          profile_image_url: googleUserInfo.picture,
        });
      }

      const token = generateToken({ userId: user.id, email: user.email });

      return res.json({
        success: true,
        token,
        isNewLink: true,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          profileImageUrl: googleUserInfo.picture || user.profile_image_url,
          phoneNumber: user.phone_number,
          onboardingCompleted: user.onboarding_completed,
          hasGoogleLinked: true,
          hasPasswordSet: !!user.password_hash && user.password_hash !== '',
        },
      });
    }

    // Scenario 3: New user - create Google-only account
    const newUser = await UserRepository.create({
      email: googleUserInfo.email,
      password_hash: null, // Google-only account has no password
      full_name: googleUserInfo.name,
      google_id: googleUserInfo.id,
      profile_image_url: googleUserInfo.picture || null,
      phone_number: null,
      is_verified: false,
      verification_status: 'none',
    });

    const token = generateToken({ userId: newUser.id, email: newUser.email });

    return res.json({
      success: true,
      token,
      isNewUser: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.full_name,
        profileImageUrl: newUser.profile_image_url,
        phoneNumber: newUser.phone_number,
        onboardingCompleted: newUser.onboarding_completed,
        hasGoogleLinked: true,
        hasPasswordSet: false,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
