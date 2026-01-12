import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { validatePhoneNumber } from '../../services/auth/validation';
import { UserRepository } from '../../services/repositories/userRepository';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const validation = validatePhoneNumber(phoneNumber);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error || 'Invalid phone number' });
    }

    const updatedUser = await UserRepository.updateProfile(payload.userId, {
      phone_number: validation.formatted,
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Update phone error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
