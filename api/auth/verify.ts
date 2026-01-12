// Verify JWT Token Endpoint
// Returns user data if token is valid

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { UserRepository } from '../../services/repositories/userRepository';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get fresh user data from database
    const user = await UserRepository.findById(payload.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return formatted user data
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        profileImageUrl: user.profile_image_url,
        phoneNumber: user.phone_number,
        onboardingCompleted: user.onboarding_completed,
        hasGoogleLinked: !!user.google_id,
        hasPasswordSet: !!user.password_hash,
      },
    });
  } catch (error) {
    console.error('Verify token error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
