import type { VercelRequest, VercelResponse } from '@vercel/node';
import { LocationRepository } from '../../services/repositories/locationRepository';
import type { LocationInsert, Location } from '../../services/types/database';

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

  const { q } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    res.status(400).json({ error: 'Query parameter "q" is required and must be at least 2 characters' });
    return;
  }

  try {
    const limit = 10;
    const query = q.trim();

    // 1. Search Local Database (Highest Priority)
    const localResults = await LocationRepository.search(query, limit);
    
    // If we have a perfect match or enough local results, we could stop here, 
    // but for "more locations" we should fetch from APIs too.
    
    // 2. Fetch from External APIs in Parallel
    const [photonResults, nominatimResults] = await Promise.all([
      searchPhoton(query),
      searchNominatim(query)
    ]);

    // 3. Merge and Deduplicate Results
    const allResults = mergeResults(localResults, photonResults, nominatimResults);
    
    // Return top N results
    res.status(200).json(allResults.slice(0, limit));

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
