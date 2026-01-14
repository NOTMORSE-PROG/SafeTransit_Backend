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

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
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
    const limit = 8;
    const query = q.trim();

    // 1. Search Local Database
    const localResults = await LocationRepository.search(query, limit);
    
    // If we have enough local results, return them
    if (localResults.length >= limit) {
      // Increment search count for the top result (assuming it's the most relevant)
      if (localResults[0]) {
        await LocationRepository.incrementSearchCount(localResults[0].id);
      }
      return res.status(200).json(localResults);
    }

    // 2. Fallback to Nominatim API
    // Calculate how many more we need
    const needed = limit - localResults.length;
    
    // Fetch from Nominatim
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: (needed * 2).toString(), // Fetch extra to filter
      countrycodes: 'ph', // Limit to Philippines
      viewbox: '120.8,14.8,121.2,14.4', // Manila area bounding box
      bounded: '0',
    });

    const nominatimResponse = await fetch(
      `${NOMINATIM_BASE_URL}/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      }
    );

    if (!nominatimResponse.ok) {
      console.error('Nominatim API error:', nominatimResponse.statusText);
      // Return local results if API fails
      return res.status(200).json(localResults);
    }

    const nominatimData = (await nominatimResponse.json()) as NominatimPlace[];
    
    // Process and cache new results
    const newResults: Location[] = [];
    
    for (const place of nominatimData) {
      const name = getShortName(place);
      const address = place.display_name;
      
      // Check if already exists in local results
      const existsLocally = localResults.some(
        (l) => l.name === name || l.address === address
      );
      
      if (!existsLocally) {
        // Check if exists in DB but wasn't returned (to avoid duplicates)
        const existingDb = await LocationRepository.findByDetails(name, address);
        
        if (existingDb) {
          newResults.push(existingDb);
        } else {
          // Cache to DB
          try {
            const newLocation: LocationInsert = {
              name,
              address,
              latitude: parseFloat(place.lat),
              longitude: parseFloat(place.lon),
              type: place.type || 'general',
              search_count: 1, // Start with 1 search count
            };
            
            const savedLocation = await LocationRepository.create(newLocation);
            newResults.push(savedLocation);
          } catch (err) {
            console.error('Error caching location:', err);
            // If caching fails, just return the object structure without ID
            newResults.push({
              id: `temp_${place.place_id}`,
              ...place,
              name,
              address,
              latitude: parseFloat(place.lat),
              longitude: parseFloat(place.lon),
              type: place.type || 'general',
              search_count: 0,
              created_at: new Date().toISOString(),
            } as Location);
          }
        }
      }
      
      if (localResults.length + newResults.length >= limit) break;
    }

    // Combine results
    const combinedResults = [...localResults, ...newResults];
    
    res.status(200).json(combinedResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
