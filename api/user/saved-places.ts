// User Saved Places API Endpoint
// Handles CRUD operations for user saved places (home, work, favorites)
// Implements Grab-like cloud sync for saved places

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { UserSavedPlacesRepository } from '../../services/repositories/userSavedPlacesRepository';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    // Handle different HTTP methods
    switch (req.method) {
      case 'GET':
        return handleGet(req, res, userId);
      case 'POST':
        return handlePost(req, res, userId);
      case 'PUT':
        return handlePut(req, res, userId);
      case 'DELETE':
        return handleDelete(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Saved places API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/user/saved-places
 * Get all saved places for the authenticated user
 */
async function handleGet(
  req: VercelRequest,
  res: VercelResponse,
  userId: string
): Promise<VercelResponse> {
  try {
    const places = await UserSavedPlacesRepository.getAllByUser(userId);

    return res.status(200).json({
      success: true,
      places: places.map(formatSavedPlace),
    });
  } catch (error) {
    console.error('Get saved places error:', error);
    return res.status(500).json({ error: 'Failed to fetch saved places' });
  }
}

/**
 * POST /api/user/saved-places
 * Create a new saved place or bulk sync from client
 */
async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  userId: string
): Promise<VercelResponse> {
  try {
    const { label, name, address, latitude, longitude, bulkSync } = req.body;

    // Handle bulk sync (for initial client sync)
    if (bulkSync && Array.isArray(req.body.places)) {
      const syncedPlaces = await UserSavedPlacesRepository.bulkSync(
        userId,
        req.body.places
      );

      return res.status(200).json({
        success: true,
        places: syncedPlaces.map(formatSavedPlace),
        synced: syncedPlaces.length,
      });
    }

    // Validate required fields for single place
    if (!label || !name || !address || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: label, name, address, latitude, longitude',
      });
    }

    // Validate label format
    if (typeof label !== 'string' || label.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid label' });
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

    // Create the saved place
    const place = await UserSavedPlacesRepository.create({
      user_id: userId,
      label: label.trim().toLowerCase(),
      name: name.trim(),
      address: address.trim(),
      latitude,
      longitude,
    });

    return res.status(201).json({
      success: true,
      place: formatSavedPlace(place),
    });
  } catch (error) {
    console.error('Create saved place error:', error);

    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes('unique')) {
      return res.status(409).json({
        error: 'A saved place with this label already exists',
      });
    }

    return res.status(500).json({ error: 'Failed to create saved place' });
  }
}

/**
 * PUT /api/user/saved-places?id={id}
 * Update an existing saved place
 * Also supports recording use: PUT /api/user/saved-places?id={id}&recordUse=true
 */
async function handlePut(
  req: VercelRequest,
  res: VercelResponse,
  userId: string
): Promise<VercelResponse> {
  try {
    const { id } = req.query;
    const recordUse = req.query.recordUse === 'true';

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Place ID is required' });
    }

    // Handle recording use
    if (recordUse) {
      await UserSavedPlacesRepository.recordUse(id, userId);
      return res.status(200).json({ success: true });
    }

    // Handle update
    const { name, address, latitude, longitude } = req.body;

    // At least one field must be provided
    if (
      name === undefined &&
      address === undefined &&
      latitude === undefined &&
      longitude === undefined
    ) {
      return res.status(400).json({
        error: 'At least one field (name, address, latitude, longitude) is required',
      });
    }

    // Validate coordinates if provided
    if (latitude !== undefined || longitude !== undefined) {
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
    }

    const updatedPlace = await UserSavedPlacesRepository.update(id, userId, {
      name: name?.trim(),
      address: address?.trim(),
      latitude,
      longitude,
    });

    return res.status(200).json({
      success: true,
      place: formatSavedPlace(updatedPlace),
    });
  } catch (error) {
    console.error('Update saved place error:', error);

    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: 'Saved place not found' });
    }

    return res.status(500).json({ error: 'Failed to update saved place' });
  }
}

/**
 * DELETE /api/user/saved-places?id={id}
 * Delete a saved place
 */
async function handleDelete(
  req: VercelRequest,
  res: VercelResponse,
  userId: string
): Promise<VercelResponse> {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Place ID is required' });
    }

    const deleted = await UserSavedPlacesRepository.delete(id, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Saved place not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Saved place deleted successfully',
    });
  } catch (error) {
    console.error('Delete saved place error:', error);
    return res.status(500).json({ error: 'Failed to delete saved place' });
  }
}

/**
 * Format saved place for API response
 * Converts snake_case to camelCase for frontend
 */
function formatSavedPlace(place: any) {
  return {
    id: place.id,
    label: place.label,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    geohash: place.geohash,
    useCount: place.use_count,
    lastUsedAt: place.last_used_at,
    createdAt: place.created_at,
    updatedAt: place.updated_at,
  };
}
