// Login API Endpoint for Vercel
// Handles user authentication with email and password
// Enforces Google-only account rules

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { UserRepository } from '../../services/repositories/userRepository';
import { comparePassword } from '../../services/auth/password';
import { validateEmail } from '../../services/auth/validation';
import { generateToken } from '../../services/auth/jwt';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Find user by email
    const user = await UserRepository.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // CRITICAL: Check if this is a Google-only account
    // If user has google_id but NO password_hash, they must use Google to login
    if (user.google_id && (!user.password_hash || user.password_hash === '')) {
      return res.status(403).json({
        error: 'This email uses Google Sign-In. Please continue with Google.',
        errorCode: 'GOOGLE_ONLY_ACCOUNT',
      });
    }

    // Verify password exists
    if (!user.password_hash || user.password_hash === '') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Compare password with hash
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        profileImageUrl: user.profile_image_url,
        hasGoogleLinked: !!user.google_id,
        hasPasswordSet: true,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
