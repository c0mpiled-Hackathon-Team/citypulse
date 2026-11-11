import type { Case, Incident } from "@/lib/types";

// Placeholder data so the map can be built and demoed before /api/triage and seed.json land.
// Remove once src/data/seed.json exists.

const base = { typicalDaysToClose: null, lat: null, lng: null, createdAt: "2026-11-11T20:00:00+08:00" };

export const SAMPLE_CASES: Case[] = [
  { ...base, id: "s1", summary: "Cars parked illegally at the corner of the lane every evening", category: "Illegal parking", office: "Taipei City Police Department", typicalDaysToClose: 3, locationText: "Da'an District", district: "Da'an" },
  { ...base, id: "s2", summary: "Loud music from a bar after midnight", category: "Noise", office: "Department of Environmental Protection", typicalDaysToClose: 5, locationText: "Da'an District", district: "Da'an" },
  { ...base, id: "s3", summary: "Scooters blocking the sidewalk near the MRT exit", category: "Illegal parking", office: "Taipei City Police Department", typicalDaysToClose: 3, locationText: "Ximending", district: "Wanhua" },
  { ...base, id: "s4", summary: "Construction noise before 7 am", category: "Noise", office: "Department of Environmental Protection", typicalDaysToClose: 5, locationText: "Neihu District", district: "Neihu" },
  { ...base, id: "s5", summary: "Car parked on the red line by the school", category: "Illegal parking", office: "Taipei City Police Department", typicalDaysToClose: 3, locationText: "Shilin District", district: "Shilin" },
  ...Array.from({ length: 12 }, (_, i) => ({
    ...base,
    id: `pipe${i + 1}`,
    summary: "Water gushing from the road, burst pipe",
    category: "Water pipe leak",
    office: "Taipei Water Department",
    typicalDaysToClose: 2,
    locationText: "Zhongxiao East Rd, Sec. 4",
    district: "Da'an",
  })),
];

export const SAMPLE_INCIDENTS: Incident[] = [
  {
    id: "inc-pipe",
    category: "Water pipe leak",
    caseIds: Array.from({ length: 12 }, (_, i) => `pipe${i + 1}`),
    lat: 25.0415,
    lng: 121.552,
  },
];
