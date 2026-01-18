// User Saved Places Repository
// Handles database operations for user saved places (home, work, favorites)
// Implements Grab-like cloud sync for saved places

import { neon } from '@neondatabase/serverless';

// Get database URL from environment
const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
};

const sql = neon(getDatabaseUrl());

export interface UserSavedPlace {
  id: string;
  user_id: string;
  label: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geohash: string;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSavedPlaceInsert {
  user_id: string;
  label: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface UserSavedPlaceUpdate {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export const UserSavedPlacesRepository = {
  /**
   * Get all saved places for a user
   * Ordered by last_used_at for quick access to frequent places
   */
  async getAllByUser(userId: string): Promise<UserSavedPlace[]> {
    const result = await sql`
      SELECT * FROM user_saved_places
      WHERE user_id = ${userId}
      ORDER BY
        CASE label
          WHEN 'home' THEN 0
          WHEN 'work' THEN 1
          ELSE 2
        END,
        last_used_at DESC NULLS LAST,
        created_at DESC
    `;
    return result as UserSavedPlace[];
  },

  /**
   * Get a specific saved place by ID
   */
  async getById(id: string, userId: string): Promise<UserSavedPlace | null> {
    const result = await sql`
      SELECT * FROM user_saved_places
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `;
    return (result[0] as UserSavedPlace) || null;
  },

  /**
   * Get saved place by label (home, work, etc.)
   */
  async getByLabel(userId: string, label: string): Promise<UserSavedPlace | null> {
    const result = await sql`
      SELECT * FROM user_saved_places
      WHERE user_id = ${userId} AND label = ${label}
      LIMIT 1
    `;
    return (result[0] as UserSavedPlace) || null;
  },

  /**
   * Create a new saved place
   * Returns existing place if label is 'home' or 'work' and already exists
   */
  async create(data: UserSavedPlaceInsert): Promise<UserSavedPlace> {
    // For home/work, check if already exists and update instead
    if (data.label === 'home' || data.label === 'work') {
      const existing = await this.getByLabel(data.user_id, data.label);
      if (existing) {
        return this.update(existing.id, data.user_id, {
          name: data.name,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
        });
      }
    }

    const result = await sql`
      INSERT INTO user_saved_places (
        user_id,
        label,
        name,
        address,
        latitude,
        longitude
      )
      VALUES (
        ${data.user_id},
        ${data.label},
        ${data.name},
        ${data.address},
        ${data.latitude},
        ${data.longitude}
      )
      RETURNING *
    `;
    return result[0] as UserSavedPlace;
  },

  /**
   * Update a saved place
   */
  async update(
    id: string,
    userId: string,
    data: UserSavedPlaceUpdate
  ): Promise<UserSavedPlace> {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push(`name = $${values.length + 1}`);
      values.push(data.name);
    }
    if (data.address !== undefined) {
      updates.push(`address = $${values.length + 1}`);
      values.push(data.address);
    }
    if (data.latitude !== undefined) {
      updates.push(`latitude = $${values.length + 1}`);
      values.push(data.latitude);
    }
    if (data.longitude !== undefined) {
      updates.push(`longitude = $${values.length + 1}`);
      values.push(data.longitude);
    }

    if (updates.length === 0) {
      // No updates, just return existing
      const existing = await this.getById(id, userId);
      if (!existing) {
        throw new Error('Saved place not found');
      }
      return existing;
    }

    const result = await sql`
      UPDATE user_saved_places
      SET
        name = COALESCE(${data.name}, name),
        address = COALESCE(${data.address}, address),
        latitude = COALESCE(${data.latitude}, latitude),
        longitude = COALESCE(${data.longitude}, longitude)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;

    if (result.length === 0) {
      throw new Error('Saved place not found or unauthorized');
    }

    return result[0] as UserSavedPlace;
  },

  /**
   * Delete a saved place
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM user_saved_places
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;
    return result.length > 0;
  },

  /**
   * Increment use count and update last_used_at
   * Called when user selects a saved place
   */
  async recordUse(id: string, userId: string): Promise<void> {
    await sql`
      UPDATE user_saved_places
      SET
        use_count = use_count + 1,
        last_used_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
    `;
  },

  /**
   * Get frequently used places (for personalization)
   * Returns places ordered by use_count
   */
  async getFrequentPlaces(userId: string, limit: number = 5): Promise<UserSavedPlace[]> {
    const result = await sql`
      SELECT * FROM user_saved_places
      WHERE user_id = ${userId} AND use_count > 0
      ORDER BY use_count DESC, last_used_at DESC
      LIMIT ${limit}
    `;
    return result as UserSavedPlace[];
  },

  /**
   * Check if a label is already used by the user
   */
  async labelExists(userId: string, label: string): Promise<boolean> {
    const result = await sql`
      SELECT 1 FROM user_saved_places
      WHERE user_id = ${userId} AND label = ${label}
      LIMIT 1
    `;
    return result.length > 0;
  },

  /**
   * Bulk sync - used for initial sync from client
   * Compares timestamps and keeps the most recent version
   */
  async bulkSync(
    userId: string,
    places: Array<UserSavedPlaceInsert & { updated_at?: string }>
  ): Promise<UserSavedPlace[]> {
    const synced: UserSavedPlace[] = [];

    for (const place of places) {
      const existing = await this.getByLabel(userId, place.label);

      if (!existing) {
        // New place, create it
        const created = await this.create(place);
        synced.push(created);
      } else if (place.updated_at) {
        // Compare timestamps, keep most recent
        const clientTime = new Date(place.updated_at).getTime();
        const serverTime = new Date(existing.updated_at).getTime();

        if (clientTime > serverTime) {
          // Client version is newer, update server
          const updated = await this.update(existing.id, userId, {
            name: place.name,
            address: place.address,
            latitude: place.latitude,
            longitude: place.longitude,
          });
          synced.push(updated);
        } else {
          // Server version is newer or same, keep it
          synced.push(existing);
        }
      } else {
        // No timestamp from client, keep server version
        synced.push(existing);
      }
    }

    return synced;
  },
};
