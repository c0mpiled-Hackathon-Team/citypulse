// Taipei districts, approximate centre points, and distance helpers.
// Used by the AI triage (to place a case when we only know the district) and by grouping.
// Owned by AI + API. The map has its own src/data/districts.json; keep names in sync.

export const DISTRICTS = [
  "Zhongzheng",
  "Datong",
  "Zhongshan",
  "Songshan",
  "Da'an",
  "Wanhua",
  "Xinyi",
  "Shilin",
  "Beitou",
  "Neihu",
  "Nangang",
  "Wenshan",
] as const;

export type District = (typeof DISTRICTS)[number];

export const DISTRICT_CENTERS: Record<District, { lat: number; lng: number }> = {
  Zhongzheng: { lat: 25.0324, lng: 121.5199 },
  Datong: { lat: 25.0634, lng: 121.513 },
  Zhongshan: { lat: 25.0685, lng: 121.5266 },
  Songshan: { lat: 25.05, lng: 121.5776 },
  "Da'an": { lat: 25.0263, lng: 121.5436 },
  Wanhua: { lat: 25.0286, lng: 121.4979 },
  Xinyi: { lat: 25.033, lng: 121.5654 },
  Shilin: { lat: 25.0929, lng: 121.526 },
  Beitou: { lat: 25.1321, lng: 121.4987 },
  Neihu: { lat: 25.0697, lng: 121.588 },
  Nangang: { lat: 25.0549, lng: 121.607 },
  Wenshan: { lat: 24.9897, lng: 121.5703 },
};

const DISTRICTS_ZH: Record<string, District> = {
  中正: "Zhongzheng",
  大同: "Datong",
  中山: "Zhongshan",
  松山: "Songshan",
  大安: "Da'an",
  萬華: "Wanhua",
  万华: "Wanhua",
  信義: "Xinyi",
  信义: "Xinyi",
  士林: "Shilin",
  北投: "Beitou",
  內湖: "Neihu",
  内湖: "Neihu",
  南港: "Nangang",
  文山: "Wenshan",
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** "Daan", "Da'an District", "大安區" → "Da'an". Unknown → null. */
export function normalizeDistrict(input: string | null | undefined): District | null {
  if (!input) return null;
  for (const [zh, en] of Object.entries(DISTRICTS_ZH)) {
    if (input.includes(zh)) return en;
  }
  const s = squash(input.replace(/district/i, ""));
  return DISTRICTS.find((d) => squash(d) === s) ?? null;
}

// Well-known streets/landmarks → district, for complaints that name a place but not the district.
// Checked in order, so more specific patterns go first.
const PLACE_HINTS: [RegExp, District][] = [
  [/zhongxiao\s*e(?:ast|\.)?\s*(?:road|rd)[^.]*?sec(?:tion|\.)?\s*5|忠孝東路五段/i, "Xinyi"],
  [/zhongxiao\s*e(?:ast|\.)?\s*(?:road|rd)[^.]*?sec(?:tion|\.)?\s*1|忠孝東路一段/i, "Zhongzheng"],
  [/zhongxiao\s*e(?:ast|\.)?\s*(?:road|rd)|忠孝東路/i, "Da'an"],
  [/taipei\s*101|xinyi\s*(?:district|shopping)|台北101|臺北101/i, "Xinyi"],
  [/ximen(?:ding)?|longshan\s*temple|西門|龍山寺/i, "Wanhua"],
  [/shilin\s*night\s*market|士林夜市/i, "Shilin"],
  [/raohe|饒河/i, "Songshan"],
  [/dihua|迪化/i, "Datong"],
  [/main\s*station|taipei\s*station|北車|台北車站|臺北車站/i, "Zhongzheng"],
  [/neihu\s*tech|內湖科技/i, "Neihu"],
  [/beitou\s*hot\s*spring|北投溫泉/i, "Beitou"],
];

/** Find the Taipei district a free-text complaint refers to (English or Chinese). */
export function findDistrictInText(text: string): District | null {
  for (const [zh, en] of Object.entries(DISTRICTS_ZH)) {
    if (text.includes(zh + "區") || text.includes(zh + "区")) return en;
  }
  const s = squash(text);
  // Longest names first so "Zhongzheng" wins over "Zhongshan" substrings, etc.
  const byLength = [...DISTRICTS].sort((a, b) => b.length - a.length);
  const named = byLength.find((d) => s.includes(squash(d)));
  if (named) return named;
  return PLACE_HINTS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
