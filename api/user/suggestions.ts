// User Location Suggestions API
// Returns personalized location suggestions based on user patterns
// Grab-like smart suggestions (time-based, frequent places, saved locations)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { getUserSuggestions, suggestHomeWorkLocations } from '../../services/locationPatterns';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userId = payload.userId;
    const { lat, lon, type } = req.query;

    // Handle different suggestion types
    if (type === 'home_work') {
      // Suggest home/work locations if not set
      const homeWorkSuggestions = await suggestHomeWorkLocations(userId);

      return res.status(200).json({
        success: true,
        suggestions: homeWorkSuggestions,
      });
    }

    // Default: Get personalized suggestions
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Parse user location if provided
    const userLocation =
      lat && lon
        ? {
            lat: parseFloat(lat as string),
            lon: parseFloat(lon as string),
          }
        : undefined;

    const suggestions = await getUserSuggestions(
      userId,
      {
        currentHour,
        dayOfWeek,
        currentLocation: userLocation,
      },
      10 // Get top 10 suggestions
    );

    return res.status(200).json({
      success: true,
      suggestions,
      context: {
        hour: currentHour,
        dayOfWeek,
      },
    });
  } catch (error) {
    console.error('Suggestions API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
