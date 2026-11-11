// Rule-based grouping of duplicate reports into incidents.
// Two cases are duplicates when: same category AND (same district OR ≤300 m apart) AND ≤48 h apart.
// Duplicates chain (A~B, B~C → one incident). Pure function: safe on the server or the client.

import type { Case, Incident } from "@/lib/types";
import { DISTRICT_CENTERS, distanceMeters, normalizeDistrict } from "@/lib/geo";

export const GROUP_MAX_DISTANCE_M = 300;
export const GROUP_MAX_HOURS = 48;

function hasCoords(c: Case): c is Case & { lat: number; lng: number } {
  return typeof c.lat === "number" && typeof c.lng === "number";
}

export function isDuplicate(a: Case, b: Case): boolean {
  if (a.category !== b.category) return false;

  const hours = Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) / 36e5;
  if (!(hours <= GROUP_MAX_HOURS)) return false; // also rejects invalid dates (NaN)

  const da = normalizeDistrict(a.district);
  const db = normalizeDistrict(b.district);
  if (da && db && da === db) return true;
  return hasCoords(a) && hasCoords(b) && distanceMeters(a, b) <= GROUP_MAX_DISTANCE_M;
}

type Options = {
  /** Smallest group to return as an incident. Default 2 (only real duplicates). Use 1 to get every case. */
  minSize?: number;
};

export function groupCases(cases: Case[], { minSize = 2 }: Options = {}): Incident[] {
  // Union-find over case indexes.
  const parent = cases.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      if (isDuplicate(cases[i], cases[j])) parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, Case[]>();
  cases.forEach((c, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  });

  const incidents: Incident[] = [];
  for (const members of groups.values()) {
    if (members.length < minSize) continue;
    const pos = centroid(members);
    if (!pos) continue; // nowhere to draw it
    const sorted = [...members].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    incidents.push({
      id: `inc-${sorted[0].id}`, // stable: named after the earliest report
      category: sorted[0].category,
      caseIds: sorted.map((c) => c.id),
      lat: pos.lat,
      lng: pos.lng,
    });
  }
  // Biggest incidents first: that's what staff should look at.
  return incidents.sort((a, b) => b.caseIds.length - a.caseIds.length);
}

/** Mean position of members with coordinates; else the centre of their district. */
function centroid(members: Case[]): { lat: number; lng: number } | null {
  const located = members.filter(hasCoords);
  if (located.length > 0) {
    return {
      lat: located.reduce((s, c) => s + c.lat, 0) / located.length,
      lng: located.reduce((s, c) => s + c.lng, 0) / located.length,
    };
  }
  for (const m of members) {
    const d = normalizeDistrict(m.district);
    if (d) return DISTRICT_CENTERS[d];
  }
  return null;
}
