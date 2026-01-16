import type { VercelRequest, VercelResponse } from '@vercel/node';
import { LocationRepository } from '../../services/repositories/locationRepository';
import type { Location } from '../../services/types/database';

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
    housenumber?: string;
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

// Coordinate precision for caching (~11m accuracy)
const COORD_PRECISION = 4;

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

  const { lat, lon } = req.query;

  // Validate coordinates
  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lon as string);

  if (isNaN(latitude) || isNaN(longitude)) {
    res.status(400).json({ error: 'Invalid coordinates. Required: lat and lon query parameters' });
    return;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    res.status(400).json({ error: 'Coordinates out of range' });
    return;
  }

  try {
    // 1. Check database cache first (by rounded coordinates)
    const cached = await LocationRepository.findByCoordinates(latitude, longitude, COORD_PRECISION);
    if (cached) {
      return res.status(200).json({
        id: cached.id,
        name: cached.name,
        address: cached.address,
        latitude: cached.latitude,
        longitude: cached.longitude,
        type: cached.type,
        source: 'cache'
      });
    }

    // 2. Try external APIs in sequence (Photon first - no rate limits)
    let result = await reverseGeocodePhoton(latitude, longitude);

    if (!result) {
      result = await reverseGeocodeNominatim(latitude, longitude);
    }

    // 3. Fallback to coordinate display if all APIs fail
    if (!result) {
      return res.status(200).json({
        id: `coord_${latitude.toFixed(COORD_PRECISION)}_${longitude.toFixed(COORD_PRECISION)}`,
        name: 'Selected Location',
        address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        latitude,
        longitude,
        type: 'pin_drop',
        source: 'fallback'
      });
    }

    // 4. Cache the result in database for future requests
    try {
      await LocationRepository.cacheReverseGeocode({
        name: result.name,
        address: result.address,
        latitude: result.latitude,
        longitude: result.longitude,
        type: result.type || 'general'
      });
    } catch (cacheError) {
      // Non-critical - log but don't fail the request
      console.warn('Failed to cache reverse geocode result:', cacheError);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Reverse geocode error:', error);

    // Return fallback even on error
    return res.status(200).json({
      id: `error_${Date.now()}`,
      name: 'Selected Location',
      address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      latitude,
      longitude,
      type: 'pin_drop',
      source: 'error_fallback'
    });
  }
}

async function reverseGeocodePhoton(latitude: number, longitude: number): Promise<Location | null> {
  try {
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lon: longitude.toString(),
      limit: '1',
      lang: 'en',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(`${PHOTON_BASE_URL}/reverse?${params.toString()}`, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as PhotonResponse;

    if (!data.features || data.features.length === 0) return null;

    const feature = data.features[0];
    const { properties, geometry } = feature;

    // Build name from available data
    const name = properties.name ||
                 properties.street ||
                 properties.district ||
                 properties.city ||
                 'Unknown Location';

    // Build address from parts
    const addressParts = [
      properties.housenumber && properties.street
        ? `${properties.housenumber} ${properties.street}`
        : properties.street,
      properties.district || properties.locality,
      properties.city,
      properties.country
    ].filter(Boolean);

    const address = addressParts.length > 0
      ? addressParts.join(', ')
      : name;

    return {
      id: `photon_${properties.osm_id || Date.now()}`,
      name,
      address,
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
      type: properties.type || 'general',
      search_count: 0,
      created_at: new Date().toISOString(),
      source: 'photon'
    } as Location & { source: string };
  } catch (error) {
    console.error('Photon reverse geocode error:', error);
    return null;
  }
}

async function reverseGeocodeNominatim(latitude: number, longitude: number): Promise<Location | null> {
  try {
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lon: longitude.toString(),
      format: 'json',
      addressdetails: '1',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const place = (await response.json()) as NominatimPlace;

    if (!place || !place.display_name) return null;

    return {
      id: `nominatim_${place.place_id}`,
      name: getShortName(place),
      address: place.display_name,
      latitude: parseFloat(place.lat),
      longitude: parseFloat(place.lon),
      type: place.type || 'general',
      search_count: 0,
      created_at: new Date().toISOString(),
      source: 'nominatim'
    } as Location & { source: string };
  } catch (error) {
    console.error('Nominatim reverse geocode error:', error);
    return null;
  }
}

/**
 * Helper to extract short name from Nominatim result
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
