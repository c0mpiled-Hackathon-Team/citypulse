"use client";

import { useRef, useState } from "react";
import type { Pick } from "@/components/map/CityMap";
import { MapWithLayers, useCategoryColors } from "@/components/map/MapWithLayers";
import { SAMPLE_CASES } from "@/components/map/sample";
import type { Case, TriageResponse } from "@/lib/types";

const EXAMPLES = [
  "Cars keep parking illegally at the corner of my lane in Da'an, and it's really loud every night.",
  "Water is gushing out of the road on Zhongxiao East Rd, Sec. 4. Looks like a burst pipe.",
  "巷口一直有人違停，晚上還很吵",
];

const MODE_LABEL: Record<TriageResponse["mode"], string> = {
  live: "AI triage",
  mock: "Demo mode (no AI key)",
  fallback: "AI unavailable, keyword triage",
};

// Resident's view: describe a problem → AI splits and routes it → new cases appear on the city map.
export function ReportDesk() {
  const [cases, setCases] = useState<Case[]>(SAMPLE_CASES);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TriageResponse["mode"] | null>(null);
  const { colors } = useCategoryColors(cases);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function submit(complaint: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: complaint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
      const data = json as TriageResponse;
      // A spot the resident clicked on the map beats the AI's guess from the text.
      const created = data.cases.map((c) =>
        picked && picked.district
          ? { ...c, lat: picked.lat, lng: picked.lng, district: picked.district }
          : c,
      );
      setCases((prev) => [...prev, ...created]);
      setNewIds(created.map((c) => c.id));
      setMode(data.mode);
      setText("");
      setPicked(null);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const created = cases.filter((c) => newIds.includes(c.id));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:py-12">
      <header>
        <p className="text-sm font-medium text-rose-600">Taipei 1999 hotline</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">CityPulse</h1>
        <p className="mt-2 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          Describe a problem in your neighbourhood. CityPulse splits it into cases, routes each one to the right
          office, and puts it on the city map.
        </p>
      </header>

      <form
        className="max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) submit(text);
        }}
      >
        <label htmlFor="complaint" className="text-sm font-medium">
          What&apos;s the problem?
        </label>
        <textarea
          id="complaint"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Cars keep parking illegally at the corner of my lane, and it's loud every night."
          className="mt-2 w-full resize-y rounded-xl border border-zinc-300 bg-white p-3 text-base outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={loading}
              onClick={() => {
                setText(ex);
                submit(ex);
              }}
              className="rounded-full border border-zinc-300 px-3 py-1 text-left text-sm text-zinc-700 hover:border-rose-500 hover:text-rose-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || text.trim().length < 3}
            className="rounded-xl bg-rose-600 px-5 py-3 font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Routing your report…" : "Report"}
          </button>
          <span className="text-sm text-zinc-500">
            {picked
              ? `📍 Location: ${picked.district ?? "outside Taipei"} (from the map)`
              : "Optional: click the map to mark the exact spot."}
          </span>
        </div>
        {error && (
          <p className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
      </form>

      {created.length > 0 && (
        <section ref={resultsRef} className="scroll-mt-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-semibold">
              Your report became {created.length} case{created.length > 1 ? "s" : ""}
            </h2>
            {mode && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {MODE_LABEL[mode]}
              </span>
            )}
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {created.map((c) => (
              <li key={c.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="size-3 rounded-full" style={{ backgroundColor: colors[c.category] }} />
                  {c.category}
                </p>
                <p className="mt-2">{c.summary}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-zinc-500">Routed to</dt>
                    <dd className="font-medium">{c.office}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Usually closed in</dt>
                    <dd className="font-medium">
                      {c.typicalDaysToClose != null ? `~${c.typicalDaysToClose} days` : "Unknown"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-zinc-500">Location</dt>
                    <dd className="font-medium">
                      {[c.locationText, c.district].filter(Boolean).join(" · ") || "Not given"}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Reports across Taipei</h2>
        <MapWithLayers cases={cases} highlightIds={newIds} picked={picked} onPick={setPicked} />
        <p className="mt-2 text-xs text-zinc-500">
          District boundaries: Taipei City Department of Civil Affairs (data.taipei). Street locations: ©
          OpenStreetMap contributors. Demo data; reports are not sent to the city.
        </p>
      </section>
    </main>
  );
}
