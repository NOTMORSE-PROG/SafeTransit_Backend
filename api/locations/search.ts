import type { VercelRequest, VercelResponse } from '@vercel/node';
import { LocationRepository } from '../../services/repositories/locationRepository';
import type { LocationInsert, Location } from '../../services/types/database';
import { rankSearchResults } from '../../services/searchRanking';
import { verifyToken } from '../../services/auth/jwt';

// Nominatim API Types
interface NominatimPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    municipality?: string;
    building?: string;
    amenity?: string;
    shop?: string;
    tourism?: string;
    office?: string;
  };
}

// Photon API Types
interface PhotonFeature {
  properties: {
    osm_id: number;
    osm_type: string;
    name: string;
    street?: string;
    city?: string;
    district?: string;
    locality?: string;
    country?: string;
    type?: string;
  };
  geometry: {
    coordinates: [number, number]; // [lon, lat]
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const PHOTON_BASE_URL = 'https://photon.komoot.io';
const USER_AGENT = 'SafeTransit/1.0';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { q, lat, lon } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    res.status(400).json({ error: 'Query parameter "q" is required and must be at least 2 characters' });
    return;
  }

  // Parse user location for proximity-based search
  const userLat = lat ? parseFloat(lat as string) : null;
  const userLon = lon ? parseFloat(lon as string) : null;
  const hasUserLocation = userLat !== null && userLon !== null &&
    !isNaN(userLat) && !isNaN(userLon);

  // Extract user ID from Authorization header (optional)
  let userId: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload) {
        userId = payload.userId;
      }
    } catch (error) {
      // Non-critical: search works without auth, just no personalization
      console.log('Token verification failed, proceeding without personalization');
    }
  }

  try {
    const limit = 10;
    const query = q.trim();

    // 1. Search Local Database
    // Use proximity-based search if user location is available (Grab-like)
    let localResults: Location[];
    if (hasUserLocation) {
      // Proximity search with distance-based ranking
      localResults = await LocationRepository.searchWithProximity(
        query,
        userLat!,
        userLon!,
        50, // 50km radius for search
        limit
      );
    } else {
      // Fallback to simple search
      localResults = await LocationRepository.search(query, limit);
    }

    // 2. Fetch from External APIs in Parallel (only if local results are insufficient)
    let photonResults: Location[] = [];
    let nominatimResults: Location[] = [];

    if (localResults.length < 5) {
      [photonResults, nominatimResults] = await Promise.all([
        searchPhoton(query),
        searchNominatim(query)
      ]);
    }

    // 3. Merge and Deduplicate Results
    let allResults = mergeResults(localResults, photonResults, nominatimResults);

    // 4. Add distance to external results if user location is available
    if (hasUserLocation) {
      allResults = allResults.map(result => {
        // Only calculate distance for results that don't have it
        if (!(result as any).distance_km) {
          const distance = haversineDistance(
            userLat!,
            userLon!,
            result.latitude,
            result.longitude
          );
          return { ...result, distance_km: distance };
        }
        return result;
      });
    }

    // 5. Apply Grab-like personalized ranking (text + proximity + popularity + user history)
    const rankedResults = await rankSearchResults(allResults, {
      query,
      userLat: userLat ?? undefined,
      userLon: userLon ?? undefined,
      userId,
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
    });

    // Return top N results with ranking scores (for transparency/debugging)
    res.status(200).json(rankedResults.slice(0, limit));

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Haversine distance calculation (km)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

async function searchPhoton(query: string): Promise<Location[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: '10',
      lat: '14.5995', // Bias towards Manila
      lon: '120.9842',
      lang: 'en',
    });

    const response = await fetch(`${PHOTON_BASE_URL}/api/?${params.toString()}`);
    if (!response.ok) return [];

    const data = (await response.json()) as PhotonResponse;
    
    return data.features.map((feature, index) => {
      const { properties, geometry } = feature;
      const name = properties.name || properties.street || properties.city || 'Unknown Location';
      
      // Construct address
      const addressParts = [
        properties.street,
        properties.district || properties.locality,
        properties.city,
        properties.country
      ].filter(Boolean);
      
      const address = addressParts.join(', ');

      return {
        id: `photon_${properties.osm_id}_${index}`,
        name,
        address: address || name,
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
        type: properties.type || properties.osm_type || 'general',
        search_count: 0,
        created_at: new Date().toISOString(),
      } as Location;
    });
  } catch (error) {
    console.error('Photon API error:', error);
    return [];
  }
}

async function searchNominatim(query: string): Promise<Location[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      countrycodes: 'ph',
      viewbox: '120.90,14.75,121.15,14.30',
      bounded: '0',
    });

    const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as NominatimPlace[];

    return data.map((place) => ({
      id: `nominatim_${place.place_id}`,
      name: getShortName(place),
      address: place.display_name,
      latitude: parseFloat(place.lat),
      longitude: parseFloat(place.lon),
      type: place.type || 'general',
      search_count: 0,
      created_at: new Date().toISOString(),
    } as Location));
  } catch (error) {
    console.error('Nominatim API error:', error);
    return [];
  }
}

function mergeResults(local: Location[], photon: Location[], nominatim: Location[]): Location[] {
  const merged: Location[] = [...local];
  const seen = new Set<string>();

  // Add local IDs/Names to seen set
  local.forEach(l => {
    seen.add(l.name.toLowerCase());
    seen.add(`${l.latitude.toFixed(4)},${l.longitude.toFixed(4)}`);
  });

  // Helper to add if unique
  const addUnique = (results: Location[]) => {
    results.forEach(item => {
      const keyName = item.name.toLowerCase();
      const keyCoord = `${item.latitude.toFixed(4)},${item.longitude.toFixed(4)}`;
      
      if (!seen.has(keyName) && !seen.has(keyCoord)) {
        merged.push(item);
        seen.add(keyName);
        seen.add(keyCoord);
      }
    });
  };

  addUnique(photon);
  addUnique(nominatim);

  return merged;
}

/**
 * Helper to extract short name from Nominatim result
 * (Duplicated logic from frontend service for consistency)
 */
function getShortName(place: NominatimPlace): string {
  const firstPart = place.display_name.split(',')[0].trim();

  if (place.address) {
    const {
      road,
      suburb,
      city,
      municipality,
      building,
      amenity,
      shop,
      tourism,
      office
    } = place.address;

    if (building && building !== firstPart) return building;
    if (amenity) return amenity;
    if (shop) return shop;
    if (tourism) return tourism;
    if (office) return office;

    if (road) {
      const area = suburb || city || municipality;
      if (area && area !== road) {
        return `${road}, ${area}`;
      }
      return road;
    }

    if (suburb) return suburb;
    if (city) return city;
    if (municipality) return municipality;
  }

  return firstPart;
}
