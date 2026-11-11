// Taipei districts: name normalization, finding districts in free text, and distance helpers.
// Used by the AI triage and by grouping. Centre points come from the map's src/data/districts.json.

import districtsData from "@/data/districts.json";

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

/** Centre of a district, from the map team's districts.json (single source of truth). */
export function districtCenter(d: District): { lat: number; lng: number } | null {
  const row = (districtsData as { name: string; lat: number; lng: number }[]).find((x) => x.name === d);
  return row ? { lat: row.lat, lng: row.lng } : null;
}

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

/** A model-supplied district field: "Daan", "Da'an District", "大安區" → "Da'an". Unknown → null. */
export function normalizeDistrict(input: string | null | undefined): District | null {
  if (!input) return null;
  for (const [zh, en] of Object.entries(DISTRICTS_ZH)) {
    if (input.includes(zh)) return en;
  }
  const s = squash(input.replace(/district/i, ""));
  return DISTRICTS.find((d) => squash(d) === s) ?? null;
}

// Whole-word district name in English text ("Da'an", "Daan", "Da-an", "Da an"), but not when it is
// part of a road name: "Xinyi Rd" runs through Da'an, "Zhongshan N Rd" through several districts.
const ROAD_AFTER = String.raw`(?!\s+(?:(?:N|S|E|W|North|South|East|West)\.?\s+)?(?:Rd|Road|St|Street|Ave|Avenue|Blvd)\b)`;
const DISTRICT_PATTERNS: [RegExp, District][] = DISTRICTS.map((d) => [
  new RegExp(String.raw`\b${d.replace("'", String.raw`['’\- ]?`)}\b${ROAD_AFTER}`, "i"),
  d,
]);

// Well-known streets/landmarks → district, for complaints that name a place but not the district.
// Checked in order, so more specific patterns go first.
const PLACE_HINTS: [RegExp, District][] = [
  [/zhongxiao\s*e(?:ast|\.)?\s*(?:road|rd).{0,20}?sec(?:tion|\.)?\s*5|忠孝東路五段/i, "Xinyi"],
  [/zhongxiao\s*e(?:ast|\.)?\s*(?:road|rd).{0,20}?sec(?:tion|\.)?\s*1|忠孝東路一段/i, "Zhongzheng"],
  [/zhongxiao\s*e(?:ast|\.)?\s*(?:road|rd)|忠孝東路/i, "Da'an"],
  [/taipei\s*101|台北101|臺北101/i, "Xinyi"],
  [/ximen(?:ding)?|longshan\s*temple|西門|龍山寺/i, "Wanhua"],
  [/shilin\s*night\s*market|士林夜市/i, "Shilin"],
  [/raohe|饒河/i, "Songshan"],
  [/dihua|迪化/i, "Datong"],
  [/main\s*station|taipei\s*station|北車|台北車站|臺北車站/i, "Zhongzheng"],
  [/neihu\s*tech|內湖科技/i, "Neihu"],
  [/beitou\s*hot\s*spring|北投溫泉/i, "Beitou"],
];

/** Every district a complaint names (Chinese "…區", whole-word English names), else from place hints. */
export function districtsInText(text: string): District[] {
  const found = new Set<District>();
  for (const [zh, en] of Object.entries(DISTRICTS_ZH)) {
    if (text.includes(zh + "區") || text.includes(zh + "区")) found.add(en);
  }
  for (const [re, d] of DISTRICT_PATTERNS) if (re.test(text)) found.add(d);
  if (found.size === 0) {
    const hint = PLACE_HINTS.find(([re]) => re.test(text));
    if (hint) found.add(hint[1]);
  }
  return [...found];
}

/** The district a piece of text refers to, only when it is unambiguous (exactly one). */
export function findDistrictInText(text: string | null | undefined): District | null {
  if (!text) return null;
  const all = districtsInText(text);
  return all.length === 1 ? all[0] : null;
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
