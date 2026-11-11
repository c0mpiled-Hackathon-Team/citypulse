import shapes from "@/data/district-shapes.json";

// Street-level geocoding with OpenStreetMap Nominatim, browser-side.
// Nominatim policy: max 1 request/second, cache results. Answers are only trusted if they land
// inside Taipei (it happily returns "Zhongxiao East Rd" in New Taipei), else the caller falls back
// to the district centre.

type Ring = number[][]; // [lng, lat] pairs
type Feature = { properties: { name: string }; geometry: { type: string; coordinates: unknown } };

function inRing([lng, lat]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inFeature(point: [number, number], f: Feature): boolean {
  const polygons = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
  return polygons.some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((hole) => inRing(point, hole)));
}

// Which Taipei district a point is in, or null if it's outside the city.
export function districtAt(lat: number, lng: number): string | null {
  const f = (shapes.features as Feature[]).find((feat) => inFeature([lng, lat], feat));
  return f ? f.properties.name : null;
}

const CACHE_KEY = "citypulse-geocode-v1";
const cache = new Map<string, [number, number] | null>();
try {
  for (const [k, v] of JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]")) cache.set(k, v);
} catch {}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...cache]));
  } catch {}
}

let queue: Promise<unknown> = Promise.resolve();

// Returns [lat, lng] inside Taipei (and inside `district` if given), or null.
export function geocode(text: string, district: string | null): Promise<[number, number] | null> {
  const key = `${text}|${district ?? ""}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);

  const job = queue.then(async () => {
    if (cache.has(key)) return cache.get(key)!;
    let result: [number, number] | null = null;
    try {
      const params = new URLSearchParams({
        q: `${text}, Taipei`,
        format: "jsonv2",
        limit: "5",
        countrycodes: "tw",
        viewbox: "121.45,25.22,121.67,24.95",
        bounded: "1",
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        signal: AbortSignal.timeout(6000),
      });
      const hits: { lat: string; lon: string }[] = res.ok ? await res.json() : [];
      for (const hit of hits) {
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        const found = districtAt(lat, lng);
        if (found && (!district || found === district)) {
          result = [lat, lng];
          break;
        }
      }
    } catch {
      // Network error or timeout: leave it to the district fallback.
    }
    cache.set(key, result);
    saveCache();
    await new Promise((r) => setTimeout(r, 1100)); // stay under 1 request/second
    return result;
  });
  queue = job;
  return job;
}
