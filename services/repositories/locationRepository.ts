// Location Repository
// Handles database operations for location search and caching

import { neon } from '@neondatabase/serverless';
import type { Location, LocationInsert, QueryResult } from '../types/database';

// Get database URL from environment
const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
};

const sql = neon(getDatabaseUrl());

export const LocationRepository = {
  /**
   * Search locations by name or address
   * Uses trigram similarity for fuzzy matching
   */
  async search(query: string, limit: number = 5): Promise<Location[]> {
    // Simple ILIKE search for now, can be upgraded to full text search later
    const searchPattern = `%${query}%`;
    
    const result = await sql`
      SELECT * FROM locations
      WHERE 
        name ILIKE ${searchPattern} OR 
        address ILIKE ${searchPattern}
      ORDER BY 
        CASE 
          WHEN name ILIKE ${query} THEN 0  -- Exact match priority
          WHEN name ILIKE ${query + '%'} THEN 1 -- Starts with priority
          ELSE 2
        END,
        search_count DESC
      LIMIT ${limit}
    `;
    return result as Location[];
  },

  /**
   * Find location by exact name and address (to prevent duplicates)
   */
  async findByDetails(name: string, address: string): Promise<Location | null> {
    const result = await sql`
      SELECT * FROM locations 
      WHERE name = ${name} AND address = ${address}
      LIMIT 1
    `;
    return (result[0] as Location) || null;
  },

  /**
   * Create a new location
   */
  async create(data: LocationInsert): Promise<Location> {
    const result = await sql`
      INSERT INTO locations (
        name,
        address,
        latitude,
        longitude,
        type,
        search_count
      )
      VALUES (
        ${data.name},
        ${data.address},
        ${data.latitude},
        ${data.longitude},
        ${data.type},
        ${data.search_count || 0}
      )
      RETURNING *
    `;
    return result[0] as Location;
  },

  /**
   * Increment search count for a location
   */
  async incrementSearchCount(id: string): Promise<boolean> {
    const result = await sql`
      UPDATE locations
      SET search_count = search_count + 1
      WHERE id = ${id}
    `;
    return (result as unknown as QueryResult).count > 0;
  },
  
  /**
   * Get popular locations
   */
  async getPopular(limit: number = 5): Promise<Location[]> {
    const result = await sql`
      SELECT * FROM locations
      ORDER BY search_count DESC
      LIMIT ${limit}
    `;
    return result as Location[];
  },

  /**
   * Find cached location by coordinates
   * Uses rounded coordinates for approximate matching (~11m precision at 4 decimals)
   */
  async findByCoordinates(
    latitude: number,
    longitude: number,
    precision: number = 4
  ): Promise<Location | null> {
    const lat = parseFloat(latitude.toFixed(precision));
    const lon = parseFloat(longitude.toFixed(precision));

    const result = await sql`
      SELECT * FROM locations
      WHERE
        ROUND(latitude::numeric, ${precision}) = ROUND(${lat}::numeric, ${precision}) AND
        ROUND(longitude::numeric, ${precision}) = ROUND(${lon}::numeric, ${precision})
      LIMIT 1
    `;
    return (result[0] as Location) || null;
  },

  /**
   * Cache a reverse geocode result
   * Checks for existing location by coordinates to avoid duplicates
   */
  async cacheReverseGeocode(data: LocationInsert): Promise<Location> {
    // First check if we already have a location at these coordinates
    const existing = await this.findByCoordinates(data.latitude, data.longitude);
    if (existing) {
      return existing;
    }

    // Also check by name to avoid duplicates
    const existingByName = await this.findByDetails(data.name, data.address);
    if (existingByName) {
      return existingByName;
    }

    // Create new cached location
    return this.create(data);
  },

  /**
   * Search locations with proximity-based ranking (Grab-like)
   * Combines text relevance + distance + popularity for ranking
   */
  async searchWithProximity(
    query: string,
    userLat: number,
    userLon: number,
    radiusKm: number = 20,
    limit: number = 10
  ): Promise<LocationWithDistance[]> {
    const searchPattern = `%${query}%`;

    const result = await sql`
      SELECT
        *,
        -- Haversine distance calculation (km)
        (6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${userLat})) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(${userLon})) +
            sin(radians(${userLat})) * sin(radians(latitude))
          ))
        )) as distance_km,
        -- Text similarity score (0-1)
        GREATEST(
          similarity(name, ${query}),
          similarity(address, ${query}) * 0.8
        ) as text_score
      FROM locations
      WHERE
        (name ILIKE ${searchPattern} OR address ILIKE ${searchPattern})
        AND (6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${userLat})) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(${userLon})) +
            sin(radians(${userLat})) * sin(radians(latitude))
          ))
        )) <= ${radiusKm}
      ORDER BY
        -- Composite score: relevance (35%) + proximity (35%) + popularity (30%)
        (
          GREATEST(similarity(name, ${query}), similarity(address, ${query}) * 0.8) * 0.35 +
          (1.0 - LEAST((6371 * acos(
            LEAST(1.0, GREATEST(-1.0,
              cos(radians(${userLat})) * cos(radians(latitude)) *
              cos(radians(longitude) - radians(${userLon})) +
              sin(radians(${userLat})) * sin(radians(latitude))
            ))
          )) / ${radiusKm}, 1.0)) * 0.35 +
          LEAST(search_count / 500.0, 1.0) * 0.30
        ) DESC,
        search_count DESC
      LIMIT ${limit}
    `;

    return result as LocationWithDistance[];
  },

  /**
   * Find locations by geohash prefix (fast proximity queries)
   * Uses geohash index for efficient spatial filtering
   */
  async findByGeohash(geohashPrefix: string, limit: number = 10): Promise<Location[]> {
    const result = await sql`
      SELECT * FROM locations
      WHERE geohash LIKE ${geohashPrefix + '%'}
      ORDER BY search_count DESC
      LIMIT ${limit}
    `;
    return result as Location[];
  },

  /**
   * Find nearby locations using geohash (Grab-like approach)
   * Much faster than distance calculation for initial filtering
   */
  async findNearby(
    geohashPrefixes: string[],
    limit: number = 10
  ): Promise<Location[]> {
    // Use ANY for multiple geohash prefix matching
    const patterns = geohashPrefixes.map(p => p + '%');

    const result = await sql`
      SELECT * FROM locations
      WHERE geohash LIKE ANY(${patterns})
      ORDER BY search_count DESC
      LIMIT ${limit}
    `;
    return result as Location[];
  },

  /**
   * Get popular locations near user
   */
  async getPopularNearby(
    userLat: number,
    userLon: number,
    radiusKm: number = 10,
    limit: number = 5
  ): Promise<LocationWithDistance[]> {
    const result = await sql`
      SELECT
        *,
        (6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${userLat})) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(${userLon})) +
            sin(radians(${userLat})) * sin(radians(latitude))
          ))
        )) as distance_km
      FROM locations
      WHERE (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(${userLat})) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(${userLon})) +
          sin(radians(${userLat})) * sin(radians(latitude))
        ))
      )) <= ${radiusKm}
      ORDER BY search_count DESC
      LIMIT ${limit}
    `;
    return result as LocationWithDistance[];
  },

  // ==================== PostGIS-Powered Spatial Queries ====================
  // These methods use PostGIS extension for faster and more accurate spatial queries
  // Requires migration 016_enable_postgis.sql to be run first

  /**
   * Find locations within radius using PostGIS (MUCH faster than Haversine)
   * Uses ST_DWithin with geography for accurate distance on Earth's surface
   */
  async findWithinRadiusPostGIS(
    userLat: number,
    userLon: number,
    radiusMeters: number = 5000, // Default 5km
    limit: number = 50
  ): Promise<LocationWithDistance[]> {
    try {
      const result = await sql`
        SELECT
          *,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography
          ) / 1000.0 as distance_km
        FROM locations
        WHERE ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography,
          ${radiusMeters}
        )
        ORDER BY distance_km ASC
        LIMIT ${limit}
      `;
      return result as LocationWithDistance[];
    } catch (error) {
      // Fallback to regular proximity search if PostGIS not available
      console.log('PostGIS query failed, falling back to Haversine');
      return this.searchWithProximity('', userLat, userLon, radiusMeters / 1000, limit);
    }
  },

  /**
   * Find K-nearest locations using PostGIS KNN operator
   * Extremely fast for "find closest N locations" queries
   */
  async findNearestPostGIS(
    userLat: number,
    userLon: number,
    limit: number = 10
  ): Promise<LocationWithDistance[]> {
    try {
      const result = await sql`
        SELECT
          *,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography
          ) / 1000.0 as distance_km
        FROM locations
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)
        LIMIT ${limit}
      `;
      return result as LocationWithDistance[];
    } catch (error) {
      console.log('PostGIS KNN query failed, falling back to regular search');
      return this.getPopularNearby(userLat, userLon, 20, limit);
    }
  },

  /**
   * Search with proximity using PostGIS (faster than Haversine)
   * Combines text search with spatial distance using PostGIS
   */
  async searchWithProximityPostGIS(
    query: string,
    userLat: number,
    userLon: number,
    radiusKm: number = 20,
    limit: number = 10
  ): Promise<LocationWithDistance[]> {
    try {
      const searchPattern = `%${query}%`;
      const radiusMeters = radiusKm * 1000;

      const result = await sql`
        SELECT
          *,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography
          ) / 1000.0 as distance_km,
          GREATEST(
            similarity(name, ${query}),
            similarity(address, ${query}) * 0.8
          ) as text_score
        FROM locations
        WHERE
          (name ILIKE ${searchPattern} OR address ILIKE ${searchPattern})
          AND ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography,
            ${radiusMeters}
          )
        ORDER BY
          -- Composite score: relevance (35%) + proximity (35%) + popularity (30%)
          (
            GREATEST(similarity(name, ${query}), similarity(address, ${query}) * 0.8) * 0.35 +
            (1.0 - LEAST((ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${userLon}, ${userLat}), 4326)::geography
            ) / 1000.0) / ${radiusKm}, 1.0)) * 0.35 +
            LEAST(search_count / 500.0, 1.0) * 0.30
          ) DESC,
          search_count DESC
        LIMIT ${limit}
      `;

      return result as LocationWithDistance[];
    } catch (error) {
      console.log('PostGIS search query failed, falling back to Haversine');
      return this.searchWithProximity(query, userLat, userLon, radiusKm, limit);
    }
  },

  /**
   * Check if location is within a polygon (geofencing)
   * Useful for delivery zones, service areas, etc.
   */
  async isWithinPolygon(
    lat: number,
    lon: number,
    polygonWKT: string // Well-Known Text format polygon
  ): Promise<boolean> {
    try {
      const result = await sql`
        SELECT ST_Contains(
          ST_GeomFromText(${polygonWKT}, 4326),
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
        ) as is_within
      `;
      return result[0]?.is_within || false;
    } catch (error) {
      console.error('PostGIS polygon query failed:', error);
      return false;
    }
  },

  /**
   * Get locations within polygon (e.g., delivery zone)
   */
  async findWithinPolygon(
    polygonWKT: string,
    limit: number = 100
  ): Promise<Location[]> {
    try {
      const result = await sql`
        SELECT * FROM locations
        WHERE ST_Contains(
          ST_GeomFromText(${polygonWKT}, 4326),
          geom
        )
        ORDER BY search_count DESC
        LIMIT ${limit}
      `;
      return result as Location[];
    } catch (error) {
      console.error('PostGIS polygon search failed:', error);
      return [];
    }
  }
};

// Extended type for locations with distance
export interface LocationWithDistance extends Location {
  distance_km: number;
  text_score?: number;
}
