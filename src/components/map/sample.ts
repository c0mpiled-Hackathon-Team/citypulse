import type { Case } from "@/lib/types";

// Placeholder data so the map can be built and demoed before /api/triage and seed.json land.
// Remove once src/data/seed.json exists.

const base = { typicalDaysToClose: null, lat: null, lng: null, createdAt: "2026-11-11T20:00:00+08:00" };

export const SAMPLE_CASES: Case[] = [
  { ...base, id: "s1", summary: "Cars parked illegally at the corner of the lane every evening", category: "Illegal parking", office: "Taipei City Police Department", typicalDaysToClose: 3, locationText: "Zhongshan District", district: "Zhongshan" },
  { ...base, id: "s2", summary: "Loud music from a bar after midnight", category: "Noise", office: "Department of Environmental Protection", typicalDaysToClose: 5, locationText: "Songshan District", district: "Songshan" },
  { ...base, id: "s3", summary: "Scooters blocking the sidewalk near the MRT exit", category: "Illegal parking", office: "Taipei City Police Department", typicalDaysToClose: 3, locationText: "Ximending", district: "Wanhua" },
  { ...base, id: "s6", summary: "Street performers with loud speakers outside Taipei 101 until midnight", category: "Noise", office: "Department of Environmental Protection", typicalDaysToClose: 5, locationText: "Taipei 101", district: "Xinyi" },
  { ...base, id: "s4", summary: "Construction noise before 7 am", category: "Noise", office: "Department of Environmental Protection", typicalDaysToClose: 5, locationText: "Neihu District", district: "Neihu" },
  { ...base, id: "s5", summary: "Car parked on the red line by the school", category: "Illegal parking", office: "Taipei City Police Department", typicalDaysToClose: 3, locationText: "Shilin District", district: "Shilin" },
  // 12 neighbours reporting the same burst pipe, all within ~150 m on Zhongxiao East Rd, Sec. 4.
  ...Array.from({ length: 12 }, (_, i) => ({
    ...base,
    id: `pipe${i + 1}`,
    summary: "Water gushing from the road, burst pipe",
    category: "Water pipe leak",
    office: "Taipei Water Department",
    typicalDaysToClose: 2,
    locationText: "Zhongxiao East Rd, Sec. 4",
    district: "Da'an",
    lat: 25.0414 + ((i % 4) - 1.5) * 0.0003,
    lng: 121.5513 + (Math.floor(i / 4) - 1) * 0.0004,
    createdAt: `2026-11-11T${String(18 + Math.floor(i / 4)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00+08:00`,
  })),
];
