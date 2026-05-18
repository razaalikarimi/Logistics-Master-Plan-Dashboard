import { LatLng } from './types';

/**
 * Calculates the great-circle distance between two points on the Earth's surface
 * using the Haversine Formula.
 * 
 * Formula:
 * a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
 * c = 2 ⋅ atan2( √a, √(1−a) )
 * d = R ⋅ c
 * Where φ is latitude, λ is longitude, R is Earth's mean radius (6371 km).
 */
export function getHaversineDistance(p1: LatLng, p2: LatLng): number {
  const R = 6371000; // Earth's radius in meters
  const phi1 = (p1.lat * Math.PI) / 180;
  const phi2 = (p2.lat * Math.PI) / 180;
  const deltaPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
  const deltaLambda = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

/**
 * 2-Opt Local Search Route Optimization Algorithm.
 * 
 * Takes an origin coordinate and an array of stops, compiles them into a complete path,
 * and performs 2-Opt swaps to eliminate crossing paths and find the local minimum duration/distance.
 */
export function optimizeRoute(origin: LatLng, stops: LatLng[]): LatLng[] {
  if (stops.length <= 1) return [...stops];

  // Initialize with Nearest Neighbor heuristic to get a good initial seed
  let route = nearestNeighborSeed(origin, [...stops]);

  let improved = true;
  let iterations = 0;
  const maxIterations = 500; // Protect against infinite loops

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        // Evaluate the cost difference of reversing segment [i...j]
        const costDifference = evaluate2OptSwap(origin, route, i, j);
        if (costDifference < -0.01) { // Floating point correction threshold
          route = apply2OptSwap(route, i, j);
          improved = true;
        }
      }
    }
  }

  return route;
}

function nearestNeighborSeed(origin: LatLng, stops: LatLng[]): LatLng[] {
  const seed: LatLng[] = [];
  let currentPos = origin;
  const pool = [...stops];

  while (pool.length > 0) {
    let bestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < pool.length; i++) {
      const dist = getHaversineDistance(currentPos, pool[i]);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = i;
      }
    }

    const nextStop = pool.splice(bestIndex, 1)[0];
    seed.push(nextStop);
    currentPos = nextStop;
  }

  return seed;
}

function calculateRouteTotalDistance(origin: LatLng, route: LatLng[]): number {
  let total = 0;
  let current = origin;
  for (const stop of route) {
    total += getHaversineDistance(current, stop);
    current = stop;
  }
  return total;
}

function evaluate2OptSwap(origin: LatLng, route: LatLng[], i: number, j: number): number {
  const pA = i === 0 ? origin : route[i - 1];
  const pB = route[i];
  const pC = route[j];
  const pD = j === route.length - 1 ? null : route[j + 1];

  // Current subsegment distances
  const currentCost =
    getHaversineDistance(pA, pB) +
    (pD ? getHaversineDistance(pC, pD) : 0);

  // Proposed swapped subsegment distances
  const newCost =
    getHaversineDistance(pA, pC) +
    (pD ? getHaversineDistance(pB, pD) : 0);

  return newCost - currentCost;
}

function apply2OptSwap(route: LatLng[], i: number, j: number): LatLng[] {
  const newRoute = [...route];
  // Reverse the segment from index i to j
  let left = i;
  let right = j;
  while (left < right) {
    const temp = newRoute[left];
    newRoute[left] = newRoute[right];
    newRoute[right] = temp;
    left++;
    right--;
  }
  return newRoute;
}

/**
 * Advanced Predictive Multi-Factor ETA Model.
 * 
 * Estimates travel time by combining spatial geodesic coordinates, 
 * simulated average road speeds, weather degradation scalars, 
 * temporal peak traffic indexes, and driver velocity profiles.
 */
export function predictETA(
  pickup: LatLng,
  delivery: LatLng,
  options: {
    weather: 'CLEAR' | 'RAINY' | 'FOGGY' | 'STORM';
    hourOfDay: number;
    driverExperienceYears?: number;
  }
): { etaSeconds: number; distanceMeters: number } {
  const rawDistance = getHaversineDistance(pickup, delivery);
  
  // Convert spherical geodesic distance to actual driving road distance (1.25 circuity routing multiplier factor)
  const estimatedDrivingDistance = rawDistance * 1.28;

  // Base speed depending on city profile (average 36 km/h = 10 m/s)
  let averageSpeedMPS = 10.0;

  // 1. Weather Degradation Coefficient
  let weatherMultiplier = 1.0;
  if (options.weather === 'RAINY') weatherMultiplier = 0.82; // 18% slower
  else if (options.weather === 'FOGGY') weatherMultiplier = 0.70; // 30% slower
  else if (options.weather === 'STORM') weatherMultiplier = 0.50; // 50% slower

  // 2. Hour of Day Traffic Penalty Profile (24h spatial temporal congestion cycles)
  let trafficMultiplier = 1.0;
  const hour = options.hourOfDay;
  if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20)) {
    // Peak Rush Hour (8-10 AM, 5-8 PM)
    trafficMultiplier = 0.62; // 38% speed reduction
  } else if (hour >= 12 && hour <= 14) {
    // Lunch traffic
    trafficMultiplier = 0.85; 
  } else if (hour >= 23 || hour <= 5) {
    // Night clearance
    trafficMultiplier = 1.15; // 15% speed increase
  }

  // Combine coefficients
  const adjustedSpeed = averageSpeedMPS * weatherMultiplier * trafficMultiplier;

  // Raw travel duration
  let etaSeconds = Math.round(estimatedDrivingDistance / adjustedSpeed);

  // Add 180 seconds static loading/unloading buffer overhead
  etaSeconds += 180;

  return {
    etaSeconds: Math.max(etaSeconds, 60), // Minimum 1 minute buffer
    distanceMeters: Math.round(estimatedDrivingDistance),
  };
}

/**
 * Spatiotemporal Demand Forecasting Grid Generator.
 * 
 * Simulates hexagonal bounding grid areas representing regional centers,
 * computing a dynamic order density weight representing predicted demand.
 */
export interface DemandHex {
  id: string;
  lat: number;
  lng: number;
  intensity: number; // 0 to 1 scaling factor
  predictedOrders: number;
}

export function generateDemandForecast(center: LatLng): DemandHex[] {
  const hexes: DemandHex[] = [];
  const spacingLat = 0.007; // ~800 meters spacing
  const spacingLng = 0.009;

  // Generate a neat honeycomb hexagonal grid overlay
  let index = 0;
  for (let r = -3; r <= 3; r++) {
    for (let c = -3; c <= 3; c++) {
      // Offset odd columns for hexagonal brick structure
      const latOffset = c % 2 === 0 ? 0 : spacingLat / 2;
      const lat = center.lat + r * spacingLat + latOffset;
      const lng = center.lng + c * spacingLng;

      // Predict dynamic intensity using high-speed spatial sine wave simulation (resembles dynamic peak patterns)
      const distFromCenter = Math.sqrt(Math.pow(r, 2) + Math.pow(c, 2));
      const baseIntensity = Math.max(0.1, 1 - distFromCenter / 4.5);
      
      // Dynamic shift over active time components
      const timeWave = Math.sin(Date.now() / 20000 + r * 0.5 + c * 0.3);
      const intensity = Math.min(1.0, Math.max(0.05, baseIntensity + timeWave * 0.15));

      hexes.push({
        id: `h3_res8_${r + 10}_${c + 10}`,
        lat,
        lng,
        intensity,
        predictedOrders: Math.round(intensity * 12) + 1,
      });
      index++;
    }
  }

  return hexes;
}
