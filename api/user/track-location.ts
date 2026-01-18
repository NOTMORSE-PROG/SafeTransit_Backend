// Track User Location Action API
// Records user location interactions for pattern analysis
// Used for Grab-like personalized suggestions

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { UserLocationHistoryRepository } from '../../services/repositories/userLocationHistoryRepository';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authorization (optional - can track anonymous users too)
    const authHeader = req.headers.authorization;
    let userId: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload) {
        userId = payload.userId;
      }
    }

    // Skip tracking if no user ID (don't track anonymous)
    if (!userId) {
      return res.status(200).json({ success: true, tracked: false });
    }

    const {
      action_type,
      latitude,
      longitude,
      location_id,
      location_name,
      location_address,
    } = req.body;

    // Validate required fields
    if (
      !action_type ||
      latitude === undefined ||
      longitude === undefined
    ) {
      return res.status(400).json({
        error: 'Missing required fields: action_type, latitude, longitude',
      });
    }

    // Validate action type
    const validActions = ['search', 'select', 'favorite', 'navigate'];
    if (!validActions.includes(action_type)) {
      return res.status(400).json({
        error: `Invalid action_type. Must be one of: ${validActions.join(', ')}`,
      });
    }

    // Validate coordinates
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // Track the action (non-blocking, errors logged but not returned)
    await UserLocationHistoryRepository.track({
      user_id: userId,
      location_id,
      action_type,
      latitude,
      longitude,
      location_name,
      location_address,
    });

    return res.status(200).json({
      success: true,
      tracked: true,
    });
  } catch (error) {
    console.error('Track location API error:', error);
    // Non-critical: return success even if tracking fails
    return res.status(200).json({
      success: true,
      tracked: false,
      error: 'Tracking failed but operation continued',
    });
  }
}
