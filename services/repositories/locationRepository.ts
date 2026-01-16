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
  }
};
