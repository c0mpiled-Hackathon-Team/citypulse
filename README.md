# CityPulse

**AI triage for Taipei's 1999 citizen hotline.** A resident describes a problem in plain English (Mandarin input works too).
CityPulse splits it into separate cases, routes each one to the right office using the city's real
1999 categories, estimates how long it usually takes to close, and pins it on a live city map, where
duplicate reports of the same problem are grouped into one incident.

YC Request for Startups track: **AI for City Hall**.

---

## Team plan (hacking ends 10:30 PM; submit by then)

> We started late, so the scope is cut down. **Must-have** first; **stretch** only once the 9:50 checkpoint works.

### Demo story (90 seconds)

1. A resident types (or speaks): *"Cars keep parking illegally at the corner of my lane in Da'an, and it's really loud every night."*
2. The AI splits it into **2 cases**: illegal parking + noise. Each case gets a real 1999 category, an office, and a typical time to close.
3. Both cases appear as **pins on the Taipei map**.
4. **Staff view:** 15 neighbours report the same burst water pipe on Zhongxiao East Road. The map shows **one grouped incident**, not 15 tickets.
5. **US pitch:** SF and NYC publish 311 data in the same shape. New city = new category file.

### Who does what

| Person | Owns (files) | Must-have | Stretch |
|---|---|---|---|
| **rtyty0615: Map** | `src/components/map/*`, `src/data/districts.json` | Leaflet map of Taipei, pins coloured by category, grouped incident = bigger circle with a count, click pin → case card. Location: district centre points (12 districts), then Nominatim geocoding if time allows | Click the map to set a location |
| **Teammate B: AI + API** | `src/app/api/*`, `src/lib/ai.ts`, `src/lib/group.ts` | `POST /api/triage`: text → cases (category **only from the real list**, office, location text, district). Validate with zod; fall back to a mock if the AI fails | `POST /api/group`: rule-based grouping (same category + same district/≤300 m + ≤48 h) |
| **Teammate C: Data + UI** | `src/data/categories.json`, `src/data/seed.json`, form + list components | `categories.json` from the data.taipei 1999 dataset: category and office **translated to English** (keep the Chinese original in a `nameZh` field), plus median days to close (estimates are fine if the CSV is slow). `seed.json` with ~30 English demo complaints, including ~15 about one burst pipe. Complaint form + case result cards | 🎤 voice input (Chrome speech recognition, `en-US`) |

### Shared data shapes (agree first, then build in parallel)

All three parts talk through `src/lib/types.ts`:

```ts
export type Case = {
  id: string;
  summary: string;          // one line, in English
  category: string;         // MUST be an English name from categories.json
  office: string;           // responsible agency, in English (e.g. "Taipei City Police Department")
  typicalDaysToClose: number | null;
  locationText: string | null;   // e.g. "Zhongxiao East Rd, Sec. 4" or "Da'an District"
  district: string | null;       // one of the 12 Taipei districts, e.g. "Da'an", "Xinyi", "Zhongshan"
  lat: number | null;
  lng: number | null;
  createdAt: string;        // ISO date
};

export type Incident = {
  id: string;
  category: string;
  caseIds: string[];        // grouped duplicate reports
  lat: number;
  lng: number;
};
```

- `POST /api/triage` body `{ text: string }` → `{ cases: Case[] }`
- Seeded demo cases: `src/data/seed.json` → `Case[]`

### Timeline

| Time | What |
|---|---|
| **8:40–8:55** | Scaffold Next.js, add `types.ts`, push, deploy to Vercel, everyone `git pull` |
| **8:55–9:50** | Build your own part in parallel. Commit small, `git pull` before every push |
| **9:50** | **Checkpoint:** one complaint → cases → pins on the map, working end to end on Vercel |
| **9:50–10:05** | Fix bugs, grouping on the map, polish. **Feature freeze at 10:05** |
| **10:05–10:25** | Record the 90-second Loom (screen + voice), submit video link + this repo URL |

### Rules for us

- **English everywhere:** UI text, AI output, seed data and code comments. Taipei place names use the
  romanized spelling on Taipei street signs (Da'an, Xinyi, Zhongxiao East Road). The AI must accept
  Mandarin input but always answers in English.
- Stay in **your own files** to avoid merge conflicts. Need to change someone else's file? Tell them first.
- `git pull` before you push. Push at least every 20 minutes.
- **Never commit API keys.** Keys go in `.env.local` (git-ignored) and in Vercel env vars.
- If Vercel won't deploy this org repo on the free plan, make the repo public or deploy from a personal fork.
- A working small demo beats a broken big one. Cut features, not the deadline.

---

## Tech

Next.js (App Router), TypeScript, Tailwind CSS, Leaflet (`react-leaflet`, OpenStreetMap tiles), zod,
an OpenAI-compatible LLM API (GMI Cloud), deployed on Vercel.

## Run locally

```bash
npm install
cp .env.example .env.local   # LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
npm run dev                  # http://localhost:3000
```

## Data

Category names, offices and close times come from Taipei's open 1999 hotline dataset on
[data.taipei](https://data.taipei). The dataset is in Chinese; we translate category and office names
to English and keep the originals alongside. It has no complaint text (privacy): the AI reads the text,
the data provides the labels and timing.
