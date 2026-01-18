// User Location History Repository
// Tracks user location patterns for personalized suggestions
// Implements Grab-like pattern detection (long-term habits + short-term mission)

import { neon } from '@neondatabase/serverless';

const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
};

const sql = neon(getDatabaseUrl());

export interface LocationHistoryEntry {
  id: string;
  user_id: string;
  location_id: string | null;
  action_type: 'search' | 'select' | 'favorite' | 'navigate';
  latitude: number;
  longitude: number;
  geohash: string;
  location_name: string | null;
  location_address: string | null;
  hour_of_day: number | null;
  day_of_week: number | null;
  created_at: string;
}

export interface FrequentLocation {
  user_id: string;
  geohash: string;
  location_id: string | null;
  location_name: string | null;
  location_address: string | null;
  latitude: number;
  longitude: number;
  visit_count: number;
  last_visit: string;
  typical_hour: number | null;
  typical_day: number | null;
  center_lat: number;
  center_lon: number;
}

export interface LocationHistoryInsert {
  user_id: string;
  location_id?: string;
  action_type: 'search' | 'select' | 'favorite' | 'navigate';
  latitude: number;
  longitude: number;
  location_name?: string;
  location_address?: string;
}

export const UserLocationHistoryRepository = {
  /**
   * Track a user action (search, select, navigate)
   * Records timestamp, location, and context for pattern analysis
   */
  async track(data: LocationHistoryInsert): Promise<void> {
    try {
      const now = new Date();
      const hourOfDay = now.getHours();
      const dayOfWeek = now.getDay();

      await sql`
        INSERT INTO user_location_history (
          user_id,
          location_id,
          action_type,
          latitude,
          longitude,
          location_name,
          location_address,
          hour_of_day,
          day_of_week
        )
        VALUES (
          ${data.user_id},
          ${data.location_id || null},
          ${data.action_type},
          ${data.latitude},
          ${data.longitude},
          ${data.location_name || null},
          ${data.location_address || null},
          ${hourOfDay},
          ${dayOfWeek}
        )
      `;
    } catch (error) {
      // Non-critical: tracking failure shouldn't break user experience
      console.error('Failed to track location history:', error);
    }
  },

  /**
   * Get user's recent location history
   */
  async getRecentHistory(
    userId: string,
    limit: number = 50
  ): Promise<LocationHistoryEntry[]> {
    const result = await sql`
      SELECT * FROM user_location_history
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result as LocationHistoryEntry[];
  },

  /**
   * Get user's frequent locations
   * Uses materialized view for performance
   */
  async getFrequentLocations(
    userId: string,
    limit: number = 10
  ): Promise<FrequentLocation[]> {
    const result = await sql`
      SELECT * FROM user_frequent_locations
      WHERE user_id = ${userId}
      ORDER BY visit_count DESC, last_visit DESC
      LIMIT ${limit}
    `;
    return result as FrequentLocation[];
  },

  /**
   * Get locations frequently visited at current time
   * Grab-like time-based suggestions
   */
  async getLocationsForTime(
    userId: string,
    hourOfDay: number,
    limit: number = 5
  ): Promise<FrequentLocation[]> {
    // Allow ±2 hour window for matching
    const result = await sql`
      SELECT * FROM user_frequent_locations
      WHERE
        user_id = ${userId}
        AND ABS(typical_hour - ${hourOfDay}) <= 2
      ORDER BY
        visit_count DESC,
        ABS(typical_hour - ${hourOfDay}) ASC,
        last_visit DESC
      LIMIT ${limit}
    `;
    return result as FrequentLocation[];
  },

  /**
   * Get nearby frequent locations
   * Returns places user often visits near a given location
   */
  async getFrequentNearby(
    userId: string,
    latitude: number,
    longitude: number,
    radiusKm: number = 5,
    limit: number = 5
  ): Promise<FrequentLocation[]> {
    const result = await sql`
      SELECT
        *,
        (6371 * acos(
          cos(radians(${latitude})) * cos(radians(center_lat)) *
          cos(radians(center_lon) - radians(${longitude})) +
          sin(radians(${latitude})) * sin(radians(center_lat))
        )) as distance_km
      FROM user_frequent_locations
      WHERE user_id = ${userId}
      HAVING distance_km <= ${radiusKm}
      ORDER BY visit_count DESC, distance_km ASC
      LIMIT ${limit}
    `;
    return result as FrequentLocation[];
  },

  /**
   * Get location visit count for a specific place
   */
  async getLocationVisitCount(
    userId: string,
    geohash: string
  ): Promise<number> {
    const result = await sql`
      SELECT COUNT(*) as count
      FROM user_location_history
      WHERE
        user_id = ${userId}
        AND geohash = ${geohash}
        AND action_type IN ('select', 'navigate')
    `;
    return result[0]?.count || 0;
  },

  /**
   * Get user's home/work patterns
   * Detects likely home (late evening) and work (morning/afternoon) locations
   */
  async detectHomeWorkPatterns(userId: string): Promise<{
    likelyHome: FrequentLocation | null;
    likelyWork: FrequentLocation | null;
  }> {
    // Home: frequent location visited in evening/night (18-23, 0-7)
    const homeResult = await sql`
      SELECT * FROM user_frequent_locations
      WHERE
        user_id = ${userId}
        AND (typical_hour >= 18 OR typical_hour <= 7)
      ORDER BY visit_count DESC
      LIMIT 1
    `;

    // Work: frequent location visited in morning/afternoon (8-17)
    const workResult = await sql`
      SELECT * FROM user_frequent_locations
      WHERE
        user_id = ${userId}
        AND typical_hour >= 8 AND typical_hour <= 17
      ORDER BY visit_count DESC
      LIMIT 1
    `;

    return {
      likelyHome: (homeResult[0] as FrequentLocation) || null,
      likelyWork: (workResult[0] as FrequentLocation) || null,
    };
  },

  /**
   * Refresh materialized view for frequent locations
   * Call periodically (e.g., every hour) for updated patterns
   */
  async refreshFrequentLocations(): Promise<void> {
    try {
      await sql`SELECT refresh_frequent_locations()`;
    } catch (error) {
      console.error('Failed to refresh frequent locations:', error);
    }
  },

  /**
   * Cleanup old history (keep last 90 days)
   * Call periodically to maintain database size
   */
  async cleanupOldHistory(): Promise<number> {
    try {
      const result = await sql`SELECT cleanup_old_location_history()`;
      return result[0]?.cleanup_old_location_history || 0;
    } catch (error) {
      console.error('Failed to cleanup old history:', error);
      return 0;
    }
  },

  /**
   * Get location history analytics for user
   * Summary of user's location patterns
   */
  async getUserAnalytics(userId: string): Promise<{
    totalActions: number;
    uniqueLocations: number;
    mostVisitedLocation: FrequentLocation | null;
    recentActivity: number; // Last 7 days
  }> {
    const [totalResult, uniqueResult, mostVisitedResult, recentResult] =
      await Promise.all([
        sql`
          SELECT COUNT(*) as count
          FROM user_location_history
          WHERE user_id = ${userId}
        `,
        sql`
          SELECT COUNT(DISTINCT geohash) as count
          FROM user_location_history
          WHERE user_id = ${userId}
        `,
        sql`
          SELECT * FROM user_frequent_locations
          WHERE user_id = ${userId}
          ORDER BY visit_count DESC
          LIMIT 1
        `,
        sql`
          SELECT COUNT(*) as count
          FROM user_location_history
          WHERE
            user_id = ${userId}
            AND created_at >= NOW() - INTERVAL '7 days'
        `,
      ]);

    return {
      totalActions: totalResult[0]?.count || 0,
      uniqueLocations: uniqueResult[0]?.count || 0,
      mostVisitedLocation: (mostVisitedResult[0] as FrequentLocation) || null,
      recentActivity: recentResult[0]?.count || 0,
    };
  },
};
