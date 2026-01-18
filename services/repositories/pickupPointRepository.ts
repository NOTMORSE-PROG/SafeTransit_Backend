/**
 * Pickup Point Repository
 * Manages verified pickup/dropoff points for locations (Grab-inspired multi-entrance system)
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export interface PickupPoint {
  id: string;
  parent_location_id: string;
  latitude: number;
  longitude: number;
  geohash: string;
  type: 'entrance' | 'gate' | 'parking' | 'platform' | 'terminal' | 'main' | 'side';
  name: string;
  description: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: 'system' | 'user' | 'admin' | null;
  verification_count: number;
  use_count: number;
  last_used_at: string | null;
  accessible: boolean;
  access_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PickupPointInsert {
  parent_location_id: string;
  latitude: number;
  longitude: number;
  type: PickupPoint['type'];
  name: string;
  description?: string;
  verified?: boolean;
  verified_by?: PickupPoint['verified_by'];
  accessible?: boolean;
  access_notes?: string;
}

export const PickupPointRepository = {
  /**
   * Get all pickup points for a location
   */
  async getForLocation(locationId: string): Promise<PickupPoint[]> {
    try {
      const result = await sql`
        SELECT * FROM pickup_points
        WHERE parent_location_id = ${locationId}
        ORDER BY verified DESC, use_count DESC, name ASC
      `;
      return result as PickupPoint[];
    } catch (error) {
      console.error('[PickupPointRepository] Error fetching for location:', error);
      return [];
    }
  },

  /**
   * Find nearest pickup point to coordinates using PostGIS
   */
  async findNearest(
    lat: number,
    lon: number,
    radiusMeters: number = 200
  ): Promise<PickupPoint | null> {
    try {
      const point = `POINT(${lon} ${lat})`;
      const result = await sql`
        SELECT
          *,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_GeomFromText(${point}), 4326)::geography
          ) AS distance_meters
        FROM pickup_points
        WHERE verified = TRUE
          AND ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_GeomFromText(${point}), 4326)::geography,
            ${radiusMeters}
          )
        ORDER BY distance_meters ASC
        LIMIT 1
      `;

      return result[0] as PickupPoint || null;
    } catch (error) {
      console.error('[PickupPointRepository] Error finding nearest:', error);
      return null;
    }
  },

  /**
   * Find nearby pickup points using geohash (fast initial filter)
   */
  async findNearbyGeohash(
    lat: number,
    lon: number,
    radiusKm: number = 0.5
  ): Promise<PickupPoint[]> {
    try {
      // Generate geohash for the coordinate (precision 5 = ~5km grid)
      const geohashPrefix = await sql`SELECT encode_geohash(${lat}, ${lon}, 5) as hash`;
      const prefix = geohashPrefix[0]?.hash || '';

      if (!prefix) return [];

      const result = await sql`
        SELECT * FROM pickup_points
        WHERE geohash LIKE ${prefix + '%'}
          AND verified = TRUE
        ORDER BY use_count DESC
        LIMIT 20
      `;

      return result as PickupPoint[];
    } catch (error) {
      console.error('[PickupPointRepository] Error finding nearby geohash:', error);
      return [];
    }
  },

  /**
   * Create user-suggested pickup point
   */
  async createSuggestion(data: PickupPointInsert): Promise<PickupPoint | null> {
    try {
      const result = await sql`
        INSERT INTO pickup_points (
          parent_location_id,
          latitude,
          longitude,
          type,
          name,
          description,
          verified,
          verified_by,
          accessible,
          access_notes
        ) VALUES (
          ${data.parent_location_id},
          ${data.latitude},
          ${data.longitude},
          ${data.type},
          ${data.name},
          ${data.description || null},
          ${data.verified || false},
          ${data.verified_by || 'user'},
          ${data.accessible !== undefined ? data.accessible : true},
          ${data.access_notes || null}
        )
        RETURNING *
      `;

      return result[0] as PickupPoint;
    } catch (error) {
      console.error('[PickupPointRepository] Error creating suggestion:', error);
      return null;
    }
  },

  /**
   * Verify/confirm a pickup point (increment verification_count)
   */
  async verify(id: string, userId: string): Promise<boolean> {
    try {
      await sql`
        UPDATE pickup_points
        SET
          verification_count = verification_count + 1,
          verified = CASE
            WHEN verification_count + 1 >= 3 THEN TRUE
            ELSE verified
          END,
          verified_at = CASE
            WHEN verification_count + 1 >= 3 AND verified = FALSE THEN NOW()
            ELSE verified_at
          END,
          verified_by = CASE
            WHEN verification_count + 1 >= 3 AND verified = FALSE THEN 'user'
            ELSE verified_by
          END
        WHERE id = ${id}
      `;

      return true;
    } catch (error) {
      console.error('[PickupPointRepository] Error verifying:', error);
      return false;
    }
  },

  /**
   * Get popular pickup points for a location (sorted by use_count)
   */
  async getPopularForLocation(
    locationId: string,
    limit: number = 5
  ): Promise<PickupPoint[]> {
    try {
      const result = await sql`
        SELECT * FROM pickup_points
        WHERE parent_location_id = ${locationId}
          AND verified = TRUE
        ORDER BY use_count DESC, verification_count DESC
        LIMIT ${limit}
      `;

      return result as PickupPoint[];
    } catch (error) {
      console.error('[PickupPointRepository] Error fetching popular:', error);
      return [];
    }
  },

  /**
   * Increment use count when pickup point is selected
   */
  async recordUse(id: string): Promise<boolean> {
    try {
      await sql`
        UPDATE pickup_points
        SET
          use_count = use_count + 1,
          last_used_at = NOW()
        WHERE id = ${id}
      `;

      return true;
    } catch (error) {
      console.error('[PickupPointRepository] Error recording use:', error);
      return false;
    }
  },

  /**
   * Get pickup points for a location with distance from user
   */
  async getForLocationWithDistance(
    locationId: string,
    userLat?: number,
    userLon?: number
  ): Promise<Array<PickupPoint & { distance_meters?: number }>> {
    try {
      if (!userLat || !userLon) {
        return await this.getForLocation(locationId);
      }

      const point = `POINT(${userLon} ${userLat})`;
      const result = await sql`
        SELECT
          *,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_GeomFromText(${point}), 4326)::geography
          ) AS distance_meters
        FROM pickup_points
        WHERE parent_location_id = ${locationId}
        ORDER BY verified DESC, distance_meters ASC
      `;

      return result as Array<PickupPoint & { distance_meters?: number }>;
    } catch (error) {
      console.error('[PickupPointRepository] Error fetching with distance:', error);
      return [];
    }
  },

  /**
   * Find pickup points near coordinates (within radius)
   * Used to match pickup points to locations from external APIs
   */
  async findNearby(
    lat: number,
    lon: number,
    radiusMeters: number = 100,
    userLat?: number,
    userLon?: number
  ): Promise<Array<PickupPoint & { distance_meters?: number }>> {
    try {
      const locationPoint = `POINT(${lon} ${lat})`;
      const userPoint = userLat && userLon ? `POINT(${userLon} ${userLat})` : null;

      const result = await sql`
        SELECT
          *,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_GeomFromText(${locationPoint}), 4326)::geography
          ) AS location_distance_meters
          ${userPoint ? sql`, ST_Distance(
            geom::geography,
            ST_SetSRID(ST_GeomFromText(${userPoint}), 4326)::geography
          ) AS distance_meters` : sql``}
        FROM pickup_points
        WHERE verified = TRUE
          AND ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_GeomFromText(${locationPoint}), 4326)::geography,
            ${radiusMeters}
          )
        ORDER BY
          verified DESC,
          ${userPoint ? sql`distance_meters ASC` : sql`location_distance_meters ASC`}
        LIMIT 10
      `;

      return result as Array<PickupPoint & { distance_meters?: number }>;
    } catch (error) {
      console.error('[PickupPointRepository] Error finding nearby:', error);
      return [];
    }
  },
};
