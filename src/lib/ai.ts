// AI triage: complaint text → Case[]. Server-only (reads LLM_* env vars).
// Live mode calls an OpenAI-compatible chat API; output is validated with zod and every category is
// forced onto the real list in src/data/categories.json. No key → mock; AI error → keyword fallback.

import { z } from "zod";
import categoriesData from "@/data/categories.json";
import type { Case, Category, TriageResponse } from "@/lib/types";
import { DISTRICTS, DISTRICT_CENTERS, findDistrictInText, normalizeDistrict, type District } from "@/lib/geo";

export const CATEGORIES = categoriesData as Category[];
const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

const MAX_TEXT_LENGTH = 4000;
const LLM_TIMEOUT_MS = 20000;

// ---------- category lookup ----------

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");

/** Map whatever the model said ("illegal-parking", "違規停車") to a real Category, or null. */
export function resolveCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null;
  const s = squash(raw);
  return (
    CATEGORIES.find((c) => squash(c.name) === s) ??
    CATEGORIES.find((c) => squash(c.nameZh) === s) ??
    CATEGORIES.find((c) => s.length > 3 && (squash(c.name).includes(s) || s.includes(squash(c.name)))) ??
    null
  );
}

// ---------- building cases ----------

type Draft = {
  summary: string;
  category: Category;
  locationText: string | null;
  district: District | null;
};

function toCase(d: Draft, now: string): Case {
  const center = d.district ? DISTRICT_CENTERS[d.district] : null;
  return {
    id: crypto.randomUUID(),
    summary: d.summary,
    category: d.category.name,
    office: d.category.office, // always from the dataset, never from the model
    typicalDaysToClose: d.category.typicalDaysToClose,
    locationText: d.locationText,
    district: d.district,
    // District centre as a first guess so pins show up; the map can refine with geocoding.
    lat: center?.lat ?? null,
    lng: center?.lng ?? null,
    createdAt: now,
  };
}

// ---------- live (LLM) mode ----------

const LlmCaseSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  category: z.enum(CATEGORY_NAMES as [string, ...string[]]),
  locationText: z.string().trim().min(1).max(200).nullable().catch(null),
  district: z.enum(DISTRICTS).nullable().catch(null),
});

const LlmOutputSchema = z.object({ cases: z.array(z.unknown()).max(10) });

function systemPrompt(): string {
  const cats = CATEGORIES.map((c) => `- ${c.name} (${c.nameZh})`).join("\n");
  return `You triage complaints sent to Taipei's 1999 citizen hotline.
Split the complaint into separate cases: one case per distinct problem. Most complaints have 1 case; some have 2-3.

For each case return:
- "summary": one short line in English describing the problem.
- "category": EXACTLY one of these category names (copy the English name exactly):
${cats}
  If nothing fits well, pick the closest one.
- "locationText": the place mentioned (street, intersection, landmark), in English using Taipei street-sign romanization (e.g. "Zhongxiao East Rd, Sec. 4"), or null if none.
- "district": one of ${DISTRICTS.join(", ")}, or null if you cannot tell.

The complaint may be in Mandarin or English. Always answer in English.
Reply with JSON only, no prose, in this shape:
{"cases":[{"summary":"...","category":"...","locationText":"...","district":"..."}]}`;
}

/** Pull a JSON object out of a model reply (handles ```json fences and <think> blocks). */
function extractJson(content: string): unknown {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callLlm(text: string): Promise<Draft[]> {
  const baseUrl = process.env.LLM_BASE_URL!.replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  const content: unknown = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM reply has no message content");

  const { cases } = LlmOutputSchema.parse(extractJson(content));
  const textDistrict = findDistrictInText(text);
  const drafts: Draft[] = [];
  for (const raw of cases) {
    // Repair near-miss category/district spellings before strict validation.
    const r = (raw ?? {}) as Record<string, unknown>;
    const category = resolveCategory(typeof r.category === "string" ? r.category : null);
    const parsed = LlmCaseSchema.safeParse({
      ...r,
      category: category?.name,
      district: normalizeDistrict(typeof r.district === "string" ? r.district : null),
    });
    if (!parsed.success || !category) continue; // drop cases outside the real category list
    drafts.push({
      summary: parsed.data.summary,
      category,
      locationText: parsed.data.locationText,
      district: (parsed.data.district as District | null) ?? textDistrict,
    });
  }
  if (drafts.length === 0) throw new Error("LLM returned no valid cases");
  return drafts;
}

// ---------- mock / fallback mode ----------

// Extra keywords per category (matched against lower-cased English or raw Chinese text).
// Keys are matched loosely to category names, so this keeps working as categories.json grows.
const KEYWORDS: Record<string, string[]> = {
  parking: ["park", "parked", "parking", "blocking", "double-park", "scooter", "停車", "違停", "違規停"],
  noise: ["noise", "noisy", "loud", "music", "karaoke", "barking", "construction at night", "噪音", "吵", "很大聲"],
  water: ["water", "pipe", "leak", "burst", "flood", "水管", "漏水", "爆管", "自來水"],
  garbage: ["garbage", "trash", "rubbish", "litter", "dump", "垃圾"],
  road: ["pothole", "road damage", "sidewalk", "pavement", "坑洞", "路面", "人行道"],
  light: ["streetlight", "street light", "lamp", "dark", "路燈"],
  tree: ["tree", "branch", "樹"],
  animal: ["dog", "cat", "animal", "rat", "stray", "狗", "貓", "動物", "老鼠"],
  signal: ["traffic light", "signal", "紅綠燈", "號誌"],
};

function keywordsFor(cat: Category): string[] {
  const name = cat.name.toLowerCase();
  const extra = Object.entries(KEYWORDS)
    .filter(([key]) => name.includes(key))
    .flatMap(([, words]) => words);
  const nameWords = name.split(/[^a-z]+/).filter((w) => w.length > 3);
  return [...extra, ...nameWords, cat.nameZh];
}

function classifyClause(clause: string): Category | null {
  const lower = clause.toLowerCase();
  let best: Category | null = null;
  let bestScore = 0;
  for (const cat of CATEGORIES) {
    const score = keywordsFor(cat).filter((k) => k && lower.includes(k.toLowerCase())).length;
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}

/** Rough location phrase: "on/at/near X ..." or a "... Road/Rd/St" name. */
function guessLocation(text: string, district: District | null): string | null {
  const road = text.match(/\b([A-Z][a-zA-Z']+(?:\s+(?:East|West|North|South))?\s+(?:Road|Rd|Street|St|Avenue|Ave|Lane|Alley)\b\.?(?:,?\s*Sec\.?\s*\d)?)/);
  if (road) return road[1];
  // Chinese street names can't be romanized without the AI; fall back to the district (English only).
  return district ? `${district} District` : null;
}

function mockSummary(cat: Category, locationText: string | null): string {
  if (!locationText) return `${cat.name} reported`;
  return `${cat.name} reported ${locationText.endsWith("District") ? "in" : "on"} ${locationText}`;
}

export function mockTriage(text: string): Draft[] {
  const district = findDistrictInText(text);
  const locationText = guessLocation(text, district);
  const clauses = text
    .split(/(?<=[.!?。！？；;，,])\s*|\s+(?:and|also|plus)\s+|而且|還有|另外|也/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const byCategory = new Map<string, Draft>();
  for (const clause of clauses) {
    const cat = classifyClause(clause);
    if (cat && !byCategory.has(cat.name)) {
      byCategory.set(cat.name, { summary: mockSummary(cat, locationText), category: cat, locationText, district });
    }
  }
  if (byCategory.size === 0) {
    // Nothing matched: best guess, and only echo the text if it's English (output must be English).
    const cat = classifyClause(text) ?? CATEGORIES[0];
    const english = !/[一-鿿]/.test(text);
    const summary = english ? (text.length > 120 ? `${text.slice(0, 117)}...` : text) : mockSummary(cat, locationText);
    byCategory.set(cat.name, { summary, category: cat, locationText, district });
  }
  return [...byCategory.values()];
}

// ---------- entry point ----------

export function llmConfigured(): boolean {
  return Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

export async function triage(rawText: string): Promise<TriageResponse> {
  const text = rawText.trim().slice(0, MAX_TEXT_LENGTH);
  const now = new Date().toISOString();

  if (!llmConfigured()) {
    return { cases: mockTriage(text).map((d) => toCase(d, now)), mode: "mock" };
  }
  try {
    const drafts = await callLlm(text);
    return { cases: drafts.map((d) => toCase(d, now)), mode: "live" };
  } catch (err) {
    console.error("[triage] AI failed, using keyword fallback:", err);
    return { cases: mockTriage(text).map((d) => toCase(d, now)), mode: "fallback" };
  }
}
