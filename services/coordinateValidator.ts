/**
 * Backend Coordinate Validation Service
 * Based on Grab's approach to ensure pins are on accessible roads, not building centers
 */

interface ValidationRule {
  maxSnapDistance: number; // meters
  strategy: string;
}

interface ValidationResult {
  latitude: number;
  longitude: number;
  adjusted: boolean;
  distance_meters?: number;
  source: 'original' | 'road_snapped';
}

// POI-specific validation rules (based on Grab research)
const VALIDATION_RULES: Record<string, ValidationRule> = {
  school: { maxSnapDistance: 100, strategy: 'Look for gate/entrance tags' },
  university: { maxSnapDistance: 100, strategy: 'Look for gate/entrance tags' },
  college: { maxSnapDistance: 100, strategy: 'Look for gate/entrance tags' },
  mall: { maxSnapDistance: 150, strategy: 'Prefer main roads, parking' },
  shopping_centre: { maxSnapDistance: 150, strategy: 'Prefer main roads, parking' },
  supermarket: { maxSnapDistance: 100, strategy: 'Prefer parking area' },
  airport: { maxSnapDistance: 200, strategy: 'Validate terminal entrance' },
  aerodrome: { maxSnapDistance: 200, strategy: 'Validate terminal entrance' },
  station: { maxSnapDistance: 50, strategy: 'Check platform/entrance' },
  railway_station: { maxSnapDistance: 50, strategy: 'Check platform/entrance' },
  subway_entrance: { maxSnapDistance: 50, strategy: 'Check platform/entrance' },
  hospital: { maxSnapDistance: 100, strategy: 'Look for emergency/main entrance' },
  general: { maxSnapDistance: 50, strategy: 'Basic road validation' },
};

/**
 * Get validation rules for POI type
 */
export function getValidationRules(poiType: string): ValidationRule {
  const normalizedType = poiType?.toLowerCase() || 'general';
  return VALIDATION_RULES[normalizedType] || VALIDATION_RULES.general;
}

/**
 * Calculate Haversine distance between two coordinates (in meters)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if coordinate is on a road using Overpass API
 */
export async function isOnRoad(
  lat: number,
  lon: number,
  radiusMeters: number = 20
): Promise<boolean> {
  try {
    // Overpass API query to check for nearby highways/roads
    const query = `
      [out:json][timeout:5];
      (
        way["highway"](around:${radiusMeters},${lat},${lon});
      );
      out geom;
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[CoordinateValidator] Overpass API error:', response.status);
      return true; // Assume valid if API fails
    }

    const data = await response.json();
    return data.elements && data.elements.length > 0;
  } catch (error) {
    console.warn('[CoordinateValidator] Error checking road:', error);
    return true; // Assume valid on error (fail-safe)
  }
}

/**
 * Find nearest road to a coordinate using Overpass API
 */
async function findNearestRoad(
  lat: number,
  lon: number,
  maxDistanceMeters: number
): Promise<{ lat: number; lon: number; distance: number } | null> {
  try {
    // Query for nearest highway/road
    const query = `
      [out:json][timeout:5];
      (
        way["highway"](around:${maxDistanceMeters},${lat},${lon});
      );
      out geom;
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.elements || data.elements.length === 0) {
      return null;
    }

    // Find the closest point on any road
    let closestPoint: { lat: number; lon: number; distance: number } | null = null;

    for (const element of data.elements) {
      if (element.type === 'way' && element.geometry) {
        for (const node of element.geometry) {
          const distance = haversineDistance(lat, lon, node.lat, node.lon);
          if (!closestPoint || distance < closestPoint.distance) {
            closestPoint = { lat: node.lat, lon: node.lon, distance };
          }
        }
      }
    }

    return closestPoint;
  } catch (error) {
    console.warn('[CoordinateValidator] Error finding nearest road:', error);
    return null;
  }
}

/**
 * Snap coordinate to nearest road if it's inside a building
 * Returns adjusted coordinates or original if already valid
 */
export async function snapToNearestRoad(
  lat: number,
  lon: number,
  poiType: string = 'general'
): Promise<ValidationResult> {
  const rules = getValidationRules(poiType);

  // Step 1: Check if already on a road
  const onRoad = await isOnRoad(lat, lon, 20);

  if (onRoad) {
    return {
      latitude: lat,
      longitude: lon,
      adjusted: false,
      source: 'original',
    };
  }

  // Step 2: Not on road - find nearest road within max snap distance
  const nearestRoad = await findNearestRoad(lat, lon, rules.maxSnapDistance);

  if (!nearestRoad) {
    // No road found within acceptable distance - keep original
    return {
      latitude: lat,
      longitude: lon,
      adjusted: false,
      source: 'original',
    };
  }

  // Step 3: Snap to nearest road
  return {
    latitude: nearestRoad.lat,
    longitude: nearestRoad.lon,
    adjusted: true,
    distance_meters: nearestRoad.distance,
    source: 'road_snapped',
  };
}

/**
 * Validate and adjust coordinates (main function)
 */
export async function validateAndAdjustCoordinates(
  latitude: number,
  longitude: number,
  poiType?: string
): Promise<ValidationResult> {
  try {
    const result = await snapToNearestRoad(latitude, longitude, poiType);

    if (result.adjusted) {
      console.log(
        `[CoordinateValidator] Snapped ${poiType || 'location'} from (${latitude}, ${longitude}) to (${result.latitude}, ${result.longitude}) - ${result.distance_meters?.toFixed(1)}m`
      );
    }

    return result;
  } catch (error) {
    console.error('[CoordinateValidator] Validation error:', error);
    // Return original coordinates on error
    return {
      latitude,
      longitude,
      adjusted: false,
      source: 'original',
    };
  }
}
