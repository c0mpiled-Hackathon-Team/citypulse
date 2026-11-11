// Rule-based grouping of duplicate reports into incidents.
// A case joins an incident when: same category AND (same district as, or ≤300 m from, a member)
// AND ≤48 h after the incident's FIRST report. The window is anchored, so an incident can't keep
// sliding forward day after day. Pure function: safe on the server or the client.

import type { Case, Incident } from "@/lib/types";
import { districtCenter, distanceMeters, normalizeDistrict, type District } from "@/lib/geo";

export const GROUP_MAX_DISTANCE_M = 300;
export const GROUP_MAX_HOURS = 48;

// Per-case values computed once, not once per pair.
type Prepared = { c: Case; time: number; district: District | null; pos: { lat: number; lng: number } | null };

function prepare(c: Case): Prepared {
  const located = typeof c.lat === "number" && typeof c.lng === "number";
  return {
    c,
    time: Date.parse(c.createdAt),
    district: normalizeDistrict(c.district),
    pos: located ? { lat: c.lat!, lng: c.lng! } : null,
  };
}

function withinHours(a: number, b: number): boolean {
  return Math.abs(a - b) / 36e5 <= GROUP_MAX_HOURS; // false for invalid dates (NaN)
}

function samePlace(a: Prepared, b: Prepared): boolean {
  if (a.district && a.district === b.district) return true;
  return !!a.pos && !!b.pos && distanceMeters(a.pos, b.pos) <= GROUP_MAX_DISTANCE_M;
}

/** Pairwise rule: same category, same place, ≤48 h apart. */
export function isDuplicate(a: Case, b: Case): boolean {
  const pa = prepare(a);
  const pb = prepare(b);
  return a.category === b.category && withinHours(pa.time, pb.time) && samePlace(pa, pb);
}

type Options = {
  /** Smallest group to return as an incident. Default 2 (only real duplicates).
   *  With 1, every case that can be placed (coordinates or a known district) becomes an incident. */
  minSize?: number;
};

export function groupCases(cases: Case[], { minSize = 2 }: Options = {}): Incident[] {
  // Only same-category cases can be duplicates, so compare within each category.
  const byCategory = new Map<string, Prepared[]>();
  for (const c of cases) {
    let bucket = byCategory.get(c.category);
    if (!bucket) byCategory.set(c.category, (bucket = []));
    bucket.push(prepare(c));
  }

  const incidents: Incident[] = [];
  for (const bucket of byCategory.values()) {
    // Oldest first; each case joins the first open group whose first report is ≤48 h earlier and
    // that has a member in the same place. Cases with invalid dates stay on their own.
    bucket.sort((a, b) => a.time - b.time);
    const groups: Prepared[][] = [];
    for (const p of bucket) {
      const home = groups.find((g) => withinHours(g[0].time, p.time) && g.some((m) => samePlace(m, p)));
      if (home) home.push(p);
      else groups.push([p]);
    }

    for (const members of groups) {
      if (members.length < minSize) continue;
      const pos = centroid(members);
      if (!pos) continue; // no coordinates and no known district: nowhere to draw it
      incidents.push({
        id: `inc-${members[0].c.id}`, // named after the earliest report
        category: members[0].c.category,
        caseIds: members.map((m) => m.c.id),
        lat: pos.lat,
        lng: pos.lng,
      });
    }
  }
  // Biggest incidents first: that's what staff should look at.
  return incidents.sort((a, b) => b.caseIds.length - a.caseIds.length);
}

/** Mean position of members with coordinates; else the centre of their district. */
function centroid(members: Prepared[]): { lat: number; lng: number } | null {
  const located = members.flatMap((m) => (m.pos ? [m.pos] : []));
  if (located.length > 0) {
    return {
      lat: located.reduce((s, p) => s + p.lat, 0) / located.length,
      lng: located.reduce((s, p) => s + p.lng, 0) / located.length,
    };
  }
  for (const m of members) {
    const center = m.district ? districtCenter(m.district) : null;
    if (center) return center;
  }
  return null;
}
