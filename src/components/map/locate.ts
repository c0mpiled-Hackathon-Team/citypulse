import districts from "@/data/districts.json";
import type { Case } from "@/lib/types";

export const TAIPEI_CENTER: [number, number] = [25.045, 121.545];

// Small stable offset from the case id, so several cases in one district don't sit on the same spot.
function jitter(id: string): [number, number] {
  // FNV-1a hash: similar ids like "s1"/"s2" still land far apart.
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  const angle = (h % 360) * (Math.PI / 180);
  const r = 0.005 + ((h >>> 9) % 70) / 10000; // ~500 m–1.2 km
  return [Math.sin(angle) * r, Math.cos(angle) * r];
}

function findDistrict(name: string | null) {
  if (!name) return undefined;
  const key = name.toLowerCase().replace(/district|區|\s|'/g, "");
  return districts.find(
    (d) => d.name.toLowerCase().replace(/'/g, "") === key || d.nameZh.replace("區", "") === key,
  );
}

// Where to draw a case: its own coordinates if it has them, else its district centre (+ jitter).
// Returns null if we can't place it at all.
export function locateCase(c: Case): [number, number] | null {
  if (c.lat != null && c.lng != null) return [c.lat, c.lng];
  const district = findDistrict(c.district) ?? findDistrict(c.locationText);
  if (!district) return null;
  const [dLat, dLng] = jitter(c.id);
  return [district.lat + dLat, district.lng + dLng];
}
