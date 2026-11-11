// Shared data shapes. Map, AI/API and data/UI all build against these.
// Change them only after telling the whole team.

// One entry in src/data/categories.json (built from the data.taipei 1999 dataset).
export type Category = {
  name: string;               // English, e.g. "Illegal parking"
  nameZh: string;             // original from the dataset, e.g. "違規停車"
  office: string;             // English, e.g. "Taipei City Police Department"
  officeZh: string;
  typicalDaysToClose: number | null; // median received → closed, in days
};

// One problem extracted from a resident's complaint. One complaint can become several cases.
export type Case = {
  id: string;
  summary: string;          // one line, in English
  category: string;         // MUST be a Category.name from categories.json
  office: string;           // responsible agency, in English
  typicalDaysToClose: number | null;
  locationText: string | null;   // e.g. "Zhongxiao East Rd, Sec. 4" or "Da'an District"
  district: string | null;       // one of the 12 Taipei districts, e.g. "Da'an", "Xinyi"
  lat: number | null;
  lng: number | null;
  createdAt: string;        // ISO date
};

// Duplicate reports of the same problem, grouped for staff.
export type Incident = {
  id: string;
  category: string;
  caseIds: string[];
  lat: number;
  lng: number;
};

// POST /api/triage
export type TriageRequest = { text: string };
export type TriageResponse = { cases: Case[]; mode: "live" | "mock" | "fallback" };

// POST /api/group. minSize defaults to 2 (only real duplicates); 1 returns every placeable case.
export type GroupRequest = { cases: Case[]; minSize?: number };
export type GroupResponse = { incidents: Incident[] };

// Any 400 from /api/triage or /api/group.
export type ApiError = { error: string };
