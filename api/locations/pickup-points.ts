/**
 * API Endpoint: Get Pickup Points for a Location
 * Returns verified entrance/gate/parking pickup points (Grab-style)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PickupPointRepository } from '../../services/repositories/pickupPointRepository';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { location_id, lat, lon, limit } = req.query;

    // Validate location_id
    if (!location_id || typeof location_id !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid location_id parameter',
      });
    }

    // Parse optional user location
    const userLat = lat ? parseFloat(lat as string) : undefined;
    const userLon = lon ? parseFloat(lon as string) : undefined;
    const limitNum = limit ? parseInt(limit as string, 10) : 5;

    // Get pickup points for location
    const pickupPoints = await PickupPointRepository.getForLocationWithDistance(
      location_id,
      userLat,
      userLon
    );

    // If limit specified, apply it
    const limitedPoints = limitNum > 0 ? pickupPoints.slice(0, limitNum) : pickupPoints;

    // Format distance for display
    const formattedPoints = limitedPoints.map((point) => ({
      ...point,
      distance_km: point.distance_meters
        ? (point.distance_meters / 1000).toFixed(2)
        : undefined,
    }));

    return res.status(200).json({
      success: true,
      location_id,
      count: formattedPoints.length,
      pickup_points: formattedPoints,
    });
  } catch (error) {
    console.error('[API] Error fetching pickup points:', error);
    return res.status(500).json({
      error: 'Failed to fetch pickup points',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
