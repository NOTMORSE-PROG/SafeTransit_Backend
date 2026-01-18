// Search Ranking Service
// Implements Grab-like search ranking with user personalization
// Reference: Grab uses text relevance + proximity + popularity + user history

import { neon } from '@neondatabase/serverless';

const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
};

const sql = neon(getDatabaseUrl());

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface SearchContext {
  query: string;
  userLat?: number;
  userLon?: number;
  userId?: string;
  timeOfDay?: number; // 0-23 hour
  dayOfWeek?: number; // 0-6
}

export interface RankedLocation {
  id: string;
  name: string;
  address: string;
  type: string;
  latitude: number;
  longitude: number;
  geohash: string;
  search_count: number;
  distance_km?: number;

  // Scoring breakdown (for debugging/transparency)
  text_score: number;
  proximity_score: number;
  popularity_score: number;
  user_score: number;
  final_score: number;
}

/**
 * Calculate text relevance score using PostgreSQL similarity
 * Returns 0-1 where 1 is perfect match
 */
function calculateTextScore(result: any, query: string): number {
  // If we have similarity from SQL, use it
  if (result.text_similarity !== undefined) {
    return result.text_similarity;
  }

  // Fallback: simple scoring based on match position
  const name = result.name.toLowerCase();
  const queryLower = query.toLowerCase();

  if (name === queryLower) return 1.0; // Exact match
  if (name.startsWith(queryLower)) return 0.8; // Starts with
  if (name.includes(queryLower)) return 0.6; // Contains

  // Fuzzy match by checking word boundaries
  const words = name.split(/\s+/);
  if (words.some((word: string) => word.startsWith(queryLower))) return 0.5;

  return 0.3; // Weak match
}

/**
 * Calculate proximity score based on distance from user
 * Returns 0-1 where 1 is very close, 0 is far
 */
function calculateProximityScore(distanceKm: number | undefined): number {
  if (distanceKm === undefined) return 0.5; // No location = neutral

  // Grab typically prioritizes locations within 5km
  // Linear decay from 1.0 at 0km to 0 at 20km
  const MAX_DISTANCE = 20; // km
  if (distanceKm >= MAX_DISTANCE) return 0;

  return 1 - (distanceKm / MAX_DISTANCE);
}

/**
 * Calculate popularity score based on search count
 * Returns 0-1 where 1 is very popular
 */
function calculatePopularityScore(searchCount: number): number {
  // Normalize with logarithmic scale (popular places have exponentially more searches)
  // 1000+ searches = 1.0
  // 100 searches = 0.66
  // 10 searches = 0.33
  // 1 search = 0

  if (searchCount <= 0) return 0;

  const normalized = Math.log10(searchCount + 1) / Math.log10(1000);
  return Math.min(normalized, 1.0);
}

/**
 * Calculate user personalization score
 * Returns 0-1 based on user's history with this location
 */
function calculateUserScore(
  result: any,
  userFrequentPlaces: Set<string>,
  userSavedPlaces: Set<string>
): number {
  let score = 0;

  // Saved place (home/work/favorite) = highest boost
  if (userSavedPlaces.has(result.id)) {
    score += 1.0;
  }
  // Frequently visited = medium boost
  else if (userFrequentPlaces.has(result.id)) {
    score += 0.6;
  }

  // Time-based patterns could be added here
  // e.g., if user typically searches for this location at current time of day

  return Math.min(score, 1.0);
}

/**
 * Get user's frequent and saved places for personalization
 */
async function getUserPlacePreferences(userId: string): Promise<{
  frequentPlaces: Set<string>;
  savedPlaces: Set<string>;
}> {
  try {
    // Get saved places (home, work, favorites)
    const savedPlacesResult = await sql`
      SELECT id, label, use_count
      FROM user_saved_places
      WHERE user_id = ${userId}
    `;

    const savedPlaces = new Set(savedPlacesResult.map((p: any) => p.id));

    // For frequent places, we could track search history
    // For now, use saved places that are frequently used
    const frequentPlaces = new Set(
      savedPlacesResult
        .filter((p: any) => p.use_count > 3)
        .map((p: any) => p.id)
    );

    return { frequentPlaces, savedPlaces };
  } catch (error) {
    console.error('Failed to get user preferences:', error);
    return { frequentPlaces: new Set(), savedPlaces: new Set() };
  }
}

/**
 * Rank search results using Grab-like composite scoring
 *
 * Scoring Formula (adjustable weights):
 * - Text Relevance: 35%
 * - Proximity: 30%
 * - Popularity: 20%
 * - User Personalization: 15%
 */
export async function rankSearchResults(
  results: any[],
  context: SearchContext
): Promise<RankedLocation[]> {
  const { query, userLat, userLon, userId } = context;

  // Get user preferences if logged in
  const userPrefs = userId
    ? await getUserPlacePreferences(userId)
    : { frequentPlaces: new Set<string>(), savedPlaces: new Set<string>() };

  // Score each result
  const ranked = results.map(result => {
    // 1. Text relevance (0-1)
    const textScore = calculateTextScore(result, query);

    // 2. Proximity score (0-1)
    const proximityScore = calculateProximityScore(result.distance_km);

    // 3. Popularity score (0-1)
    const popularityScore = calculatePopularityScore(result.search_count || 0);

    // 4. User personalization score (0-1)
    const userScore = calculateUserScore(
      result,
      userPrefs.frequentPlaces,
      userPrefs.savedPlaces
    );

    // Weighted composite score (Grab-like)
    const WEIGHTS = {
      text: 0.35,
      proximity: 0.30,
      popularity: 0.20,
      user: 0.15,
    };

    const finalScore =
      textScore * WEIGHTS.text +
      proximityScore * WEIGHTS.proximity +
      popularityScore * WEIGHTS.popularity +
      userScore * WEIGHTS.user;

    return {
      ...result,
      text_score: textScore,
      proximity_score: proximityScore,
      popularity_score: popularityScore,
      user_score: userScore,
      final_score: finalScore,
    };
  });

  // Sort by final score (descending)
  return ranked.sort((a, b) => b.final_score - a.final_score);
}

/**
 * Get personalized location suggestions for user
 * Returns frequently used locations at current time of day
 */
export async function getPersonalizedSuggestions(
  userId: string,
  currentHour?: number,
  userLat?: number,
  userLon?: number,
  limit: number = 5
): Promise<any[]> {
  try {
    // Get user's saved places ordered by usage
    const suggestions = await sql`
      SELECT
        usp.*,
        CASE
          WHEN ${currentHour !== undefined} THEN
            -- Boost places typically used at this time
            -- This could be enhanced with actual time-based usage tracking
            CASE
              WHEN usp.label = 'work' AND ${currentHour} >= 8 AND ${currentHour} <= 17 THEN 1.5
              WHEN usp.label = 'home' AND (${currentHour} <= 8 OR ${currentHour} >= 18) THEN 1.5
              ELSE 1.0
            END
          ELSE 1.0
        END as time_boost
      FROM user_saved_places usp
      WHERE usp.user_id = ${userId}
      ORDER BY
        (usp.use_count * time_boost) DESC,
        usp.last_used_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    // Add distance if user location provided
    if (userLat !== undefined && userLon !== undefined) {
      return suggestions.map((s: any) => ({
        ...s,
        distance_km: haversineDistance(userLat, userLon, s.latitude, s.longitude),
      }));
    }

    return suggestions;
  } catch (error) {
    console.error('Failed to get personalized suggestions:', error);
    return [];
  }
}

/**
 * Boost search results by putting user's saved/frequent places first
 */
export function boostUserPlaces(
  results: RankedLocation[],
  userSavedPlaceIds: Set<string>
): RankedLocation[] {
  const userPlaces: RankedLocation[] = [];
  const otherPlaces: RankedLocation[] = [];

  results.forEach(result => {
    if (userSavedPlaceIds.has(result.id)) {
      userPlaces.push(result);
    } else {
      otherPlaces.push(result);
    }
  });

  // User places first, then others
  return [...userPlaces, ...otherPlaces];
}
