"use client";

// Home page dashboard. Layout and styling ported from the Lovable design (taipei-city-pulse);
// the logic is ours: complaints go through /api/triage (AI picks category + office), duplicates are
// grouped with groupCases(), and every case is drawn on the team's Leaflet map.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Pick } from "@/components/map/CityMap";
import { MapWithLayers, useCategoryColors } from "@/components/map/MapWithLayers";
import {
  ArrowUpRightIcon,
  BellIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MicIcon,
  PinIcon,
  PulseIcon,
  SearchIcon,
  StopIcon,
  XIcon,
} from "@/components/icons";
import categoriesData from "@/data/categories.json";
import seed from "@/data/seed.json";
import { DISTRICTS } from "@/lib/geo";
import { groupCases } from "@/lib/group";
import type { Case, Category, TriageResponse } from "@/lib/types";

// ---------- data ----------

const CATEGORIES = categoriesData as Category[];
const DISTRICT_OPTIONS = [...DISTRICTS].sort();
const STATUSES = ["New", "In Progress", "Resolved"] as const;
type Status = (typeof STATUSES)[number];

// UI-only fields on top of the shared Case shape.
type Complaint = Case & { status: Status; description?: string };

// Seed cases have no status yet: give the demo a realistic mix (the burst pipe is still new).
const SEED: Complaint[] = (seed as Case[]).map((c, i) => ({
  ...c,
  status: c.category === "Water pipe leak" && c.district === "Da'an" ? "New" : STATUSES[(i + 1) % 3],
}));

const PAGE_SIZE = 6;
const STATUS_PROGRESS: Record<Status, number> = { New: 15, "In Progress": 55, Resolved: 100 };
const STATUS_BADGE: Record<Status, string> = {
  New: "bg-progress text-progress-ink",
  "In Progress": "bg-surface-ink text-surface",
  Resolved: "border border-surface-line text-surface-muted",
};
const MODE_LABEL: Record<TriageResponse["mode"], string> = {
  live: "AI triage",
  mock: "Demo mode (no AI key)",
  fallback: "AI unavailable, keyword triage",
};

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- voice input (Mandarin, browser speech recognition) ----------

type Recognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const noopSubscribe = () => () => {};

function speechRecognition(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => Recognizer) ?? null;
}

// ---------- report form ----------

type SubmitResult = { cases: Complaint[]; mode: TriageResponse["mode"] };

function ReportForm({
  picked,
  onClearPick,
  onCreated,
}: {
  picked: Pick | null;
  onClearPick: () => void;
  onCreated: (r: SubmitResult) => void;
}) {
  const [category, setCategory] = useState(""); // "" = let the AI decide
  const [title, setTitle] = useState("");
  const [district, setDistrict] = useState(""); // "" = let the AI decide
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [listening, setListening] = useState(false);
  // Browser capability: false on the server, real value after hydration.
  const voiceSupported = useSyncExternalStore(
    noopSubscribe,
    () => !!speechRecognition(),
    () => false,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognizer = useRef<Recognizer | null>(null);
  const voicePrefix = useRef("");

  useEffect(() => () => recognizer.current?.stop(), []);

  const chosen = CATEGORIES.find((c) => c.name === category);

  function toggleVoice() {
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    const SR = speechRecognition();
    if (!SR) return;
    const r = new SR();
    r.lang = "zh-TW";
    r.interimResults = true;
    r.continuous = true;
    voicePrefix.current = description ? description.trimEnd() + " " : "";
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i]?.[0]?.transcript ?? "";
      setDescription(voicePrefix.current + text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognizer.current = r;
    r.start();
    setListening(true);
  }

  async function submit() {
    recognizer.current?.stop();
    // Everything the resident wrote goes to the AI as one complaint; it splits and routes it.
    const text = [
      title.trim(),
      description.trim(),
      location.trim() && `Location: ${location.trim()}`,
      district && `District: ${district}`,
    ]
      .filter(Boolean)
      .join(". ");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
      const data = json as TriageResponse;
      const created: Complaint[] = data.cases.map((c) => ({
        ...c,
        // What the resident chose explicitly beats the AI's guess.
        ...(chosen && { category: chosen.name, office: chosen.office, typicalDaysToClose: chosen.typicalDaysToClose }),
        ...(district && { district }),
        ...(location.trim() && { locationText: location.trim() }),
        // A spot clicked on the map beats both (as in the original report desk).
        ...(picked && { lat: picked.lat, lng: picked.lng, district: picked.district ?? (district || c.district) }),
        status: "New" as const,
        description: description.trim() || undefined,
      }));
      onCreated({ cases: created, mode: data.mode });
      setTitle("");
      setLocation("");
      setDescription("");
      onClearPick();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    "h-11 w-full rounded-full border border-line bg-transparent px-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-lime";
  const canSubmit = !loading && (title.trim() + description.trim()).length >= 3;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="category" className="text-sm font-medium">
          Category
        </label>
        <PillSelect id="category" value={category} onChange={setCategory} className={fieldClass}>
          <option value="" className="bg-card">
            Let AI decide
          </option>
          {CATEGORIES.map((c) => (
            <option key={c.name} value={c.name} className="bg-card">
              {c.name} · {c.nameZh}
            </option>
          ))}
        </PillSelect>
        <p className="text-xs text-ink-muted">
          {chosen
            ? `Routed to ${chosen.office}${chosen.typicalDaysToClose != null ? ` · usually closed in ${chosen.typicalDaysToClose} days` : ""}`
            : "AI picks the 1999 category and office, and splits multiple problems into separate cases."}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          placeholder="e.g. Burst pipe flooding the sidewalk"
          className={fieldClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="district" className="text-sm font-medium">
            District
          </label>
          <PillSelect id="district" value={district} onChange={setDistrict} className={fieldClass}>
            <option value="" className="bg-card">
              Let AI decide
            </option>
            {DISTRICT_OPTIONS.map((d) => (
              <option key={d} value={d} className="bg-card">
                {d}
              </option>
            ))}
          </PillSelect>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="location" className="text-sm font-medium">
            Location
          </label>
          <input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
            placeholder="e.g. Zhongxiao East Rd, Sec. 4"
            className={fieldClass}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!voiceSupported}
            title={voiceSupported ? "Dictate in Mandarin (zh-TW)" : "Voice input not supported in this browser"}
            className={cx(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-50",
              listening ? "bg-danger text-white" : "bg-canvas text-shell hover:brightness-95",
            )}
          >
            {listening ? <StopIcon className="size-3.5" /> : <MicIcon className="size-3.5" />}
            {listening ? "Stop" : "Voice (中文)"}
          </button>
        </div>
        <textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={3000}
          placeholder="What's happening? Mention every problem; the AI splits them into separate cases."
          className="w-full resize-y rounded-3xl border border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-lime"
        />
      </div>

      <p className="flex items-center gap-2 text-xs text-ink-muted">
        <PinIcon className="size-3.5 shrink-0" />
        {picked ? (
          <>
            Spot marked on the map{picked.district ? ` (${picked.district})` : " (outside Taipei)"}
            <button type="button" onClick={onClearPick} className="underline hover:text-ink">
              clear
            </button>
          </>
        ) : (
          "Optional: click the map below to mark the exact spot."
        )}
      </p>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/50 bg-danger/15 p-3 text-sm">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="h-11 w-full rounded-full bg-lime text-sm font-semibold text-lime-ink transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "Routing your report…" : "Submit complaint"}
      </button>
    </form>
  );
}

// Native select (keyboard + mobile friendly) styled as a pill with a chevron.
function PillSelect({
  id,
  value,
  onChange,
  className,
  children,
  label,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(className, "appearance-none pr-10")}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

// ---------- case card ----------

function ComplaintCard({ complaint: c, color, isNew }: { complaint: Complaint; color?: string; isNew: boolean }) {
  const when = new Date(c.createdAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
  });
  const progress = STATUS_PROGRESS[c.status];
  const place = [c.locationText, c.district].filter(Boolean).join(", ") || "Location unknown";
  const meta = [c.office, c.typicalDaysToClose == null ? null : `~${c.typicalDaysToClose}d to close`, place]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={cx(
        "flex flex-col gap-4 rounded-3xl border bg-surface p-6 text-surface-ink",
        isNew ? "border-lime ring-2 ring-lime/60" : "border-surface-line",
      )}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h3 className="text-xl font-bold leading-tight tracking-tight">{c.summary}</h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-surface-muted">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            {c.category} · {when}
          </p>
        </div>
        <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", STATUS_BADGE[c.status])}>
          {isNew ? "Just reported" : c.status}
        </span>
      </header>
      {c.description && <p className="line-clamp-3 text-sm leading-relaxed text-surface-ink/85">{c.description}</p>}
      <footer className="mt-auto space-y-3 border-t border-surface-line pt-4">
        <p className="truncate text-xs text-surface-muted" title={meta}>
          {meta}
        </p>
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-line">
            <div className="h-full rounded-full bg-progress" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[11px] tabular-nums text-surface-muted">{progress}%</span>
        </div>
      </footer>
    </article>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder: string;
  label: string;
}) {
  return (
    <PillSelect
      label={label}
      value={value}
      onChange={onChange}
      className="h-10 rounded-full border border-line bg-transparent px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-lime"
    >
      <option value="" className="bg-card">
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o} value={o} className="bg-card">
          {o}
        </option>
      ))}
    </PillSelect>
  );
}

// ---------- page ----------

export function Dashboard() {
  const [complaints, setComplaints] = useState<Complaint[]>(SEED);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [lastMode, setLastMode] = useState<TriageResponse["mode"] | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [district, setDistrict] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLElement>(null);
  const { colors } = useCategoryColors(complaints);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return complaints.filter(
      (c) =>
        (!category || c.category === category) &&
        (!district || c.district === district) &&
        (!status || c.status === status) &&
        (!q || `${c.summary} ${c.locationText ?? ""} ${c.district ?? ""} ${c.category}`.toLowerCase().includes(q)),
    );
  }, [complaints, category, district, status, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const statusCounts = STATUSES.map((s) => complaints.filter((c) => c.status === s).length);
  const byCategory = CATEGORIES.map((cat) => ({
    name: cat.name,
    n: complaints.filter((c) => c.category === cat.name).length,
  }));
  const maxCategory = Math.max(...byCategory.map((b) => b.n), 1);
  const knownDays = CATEGORIES.map((c) => c.typicalDaysToClose).filter((d): d is number => d != null);
  const avgDays = knownDays.length ? (knownDays.reduce((a, b) => a + b, 0) / knownDays.length).toFixed(1) : "–";

  // Real duplicate grouping (same rules as /api/group); show the biggest incident.
  const incidents = useMemo(() => groupCases(complaints), [complaints]);
  const top = incidents[0];
  const topDistrict = top ? complaints.find((c) => c.id === top.caseIds[0])?.district : null;

  const resetPage = () => setPage(0);

  function handleCreated({ cases, mode }: SubmitResult) {
    setComplaints((prev) => [...cases, ...prev]);
    setNewIds(cases.map((c) => c.id));
    setLastMode(mode);
    // Show the new cases: clear filters that could hide them and jump to the first page.
    setCategory("");
    setDistrict("");
    setStatus("");
    setSearch("");
    setPage(0);
  }

  const created = complaints.filter((c) => newIds.includes(c.id));

  return (
    <div className="min-h-screen w-full bg-canvas p-3 font-pulse sm:p-6">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-shell text-ink shadow-shell">
        {/* ---- hero ---- */}
        <section className="bg-hero-glow relative p-5 sm:p-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative full-bleed background */}
          <img
            src="/hero-city.jpg"
            alt=""
            width={1600}
            height={912}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90 mix-blend-multiply"
          />
          <div className="relative">
            <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 md:grid-cols-[auto_1fr_auto]">
              <div className="flex items-center gap-2 font-bold tracking-wide">
                <PulseIcon className="size-6 shrink-0" /> CITYPULSE
              </div>
              <div className="glass-dark col-span-2 row-start-2 flex items-center gap-2 rounded-full p-1.5 md:col-span-1 md:col-start-2 md:row-start-1 md:mx-auto md:w-full md:max-w-md">
                <SearchIcon className="ml-2 size-4 shrink-0 text-ink-muted" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    resetPage();
                  }}
                  aria-label="Search complaints"
                  placeholder="Search complaints, streets…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-muted"
                />
                <span className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-shell">Taipei</span>
              </div>
              <div className="flex items-center gap-3">
                <BellIcon className="size-4" />
                <span className="grid size-8 place-items-center rounded-full bg-lime text-xs font-bold text-lime-ink">
                  1999
                </span>
              </div>
            </header>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
              <div className="space-y-5">
                <h1 className="text-5xl font-semibold uppercase leading-[0.95] sm:text-6xl">
                  Your city
                  <span className="mx-3 inline-block rounded-full border border-ink/60 px-3 py-1 align-middle text-xs font-medium normal-case">
                    AI-Triage
                  </span>
                  <br />
                  in one pulse
                </h1>
                <div className="glass-dark max-w-sm rounded-3xl p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg">Report a problem</h2>
                    <ArrowUpRightIcon className="size-4" />
                  </div>
                  <div className="mt-4">
                    <ReportForm picked={picked} onClearPick={() => setPicked(null)} onCreated={handleCreated} />
                  </div>
                  {created.length > 0 && (
                    <div aria-live="polite" className="mt-4 rounded-2xl border border-lime/40 bg-lime/10 p-3 text-sm">
                      <p className="font-semibold">
                        Your report became {created.length} case{created.length > 1 ? "s" : ""}
                        {lastMode && (
                          <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-medium">
                            {MODE_LABEL[lastMode]}
                          </span>
                        )}
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                        {created.map((c) => (
                          <li key={c.id} className="flex items-center gap-2">
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[c.category] }} />
                            <span className="text-ink">{c.category}</span> → {c.office}
                            {c.typicalDaysToClose != null && ` · ~${c.typicalDaysToClose}d`}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="mt-2 text-xs font-semibold text-lime underline"
                      >
                        See them on the map
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid content-start gap-3 sm:grid-cols-2 lg:mt-40">
                <div className="glass rounded-3xl p-5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg">Cases by status</h2>
                    <ArrowUpRightIcon className="size-4" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {STATUSES.map((s, i) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStatus(status === s ? "" : s);
                          resetPage();
                        }}
                        aria-pressed={status === s}
                        className={cx(
                          "rounded-full py-2 text-sm font-medium transition",
                          status === s ? "bg-lime text-lime-ink" : i === 0 ? "bg-shell" : "bg-ink/80 text-shell",
                        )}
                      >
                        <span className="text-xl font-semibold">{statusCounts[i]}</span> <span className="text-xs">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="glass rounded-3xl p-5">
                  <div className="flex items-center justify-between">
                    <h2>Grouped incident</h2>
                    <ArrowUpRightIcon className="size-4" />
                  </div>
                  {top ? (
                    <>
                      <p className="mt-3 text-3xl font-semibold">
                        {top.caseIds.length}
                        <sup className="ml-1 text-xs">reports</sup>
                      </p>
                      <p className="text-xs">
                        {top.category}
                        {topDistrict ? ` · ${topDistrict}` : ""}
                      </p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-shell/40">
                        <div className="hatch h-full" style={{ width: `${(top.caseIds.length / complaints.length) * 100}%` }} />
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-sm">No duplicate reports yet.</p>
                  )}
                </div>

                <div className="glass rounded-3xl p-5">
                  <div className="flex items-center justify-between">
                    <h2>By category</h2>
                    <span className="text-xs">avg {avgDays}d</span>
                  </div>
                  <div className="mt-3 flex h-16 items-end gap-2">
                    {byCategory.map((b) => (
                      <button
                        key={b.name}
                        title={`${b.name}: ${b.n}`}
                        aria-label={`${b.name}: ${b.n} cases`}
                        aria-pressed={category === b.name}
                        onClick={() => {
                          setCategory(category === b.name ? "" : b.name);
                          resetPage();
                        }}
                        className={cx(
                          "flex-1 rounded-full transition-[height]",
                          category === b.name || (!category && b.name === top?.category) ? "bg-lime" : "bg-ink/80",
                        )}
                        style={{ height: `${Math.max(10, (b.n / maxCategory) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- map ---- */}
        <section ref={listRef} className="scroll-mt-4 p-5 sm:p-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold">Live city map</h2>
            <p className="text-xs text-ink-muted">
              {filtered.length} of {complaints.length} reports · {incidents.length} grouped incident
              {incidents.length === 1 ? "" : "s"} · click the map to mark a spot for your report
            </p>
          </div>
          <div className="rounded-3xl bg-canvas p-3 text-shell">
            <MapWithLayers cases={filtered} highlightIds={newIds} picked={picked} onPick={setPicked} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            District boundaries: Taipei City Department of Civil Affairs (data.taipei). Street locations: ©
            OpenStreetMap contributors. Demo data; reports are not sent to the city.
          </p>
        </section>

        {/* ---- case list ---- */}
        <section className="p-5 pt-0 sm:p-8 sm:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Filter by category"
              value={category}
              onChange={(v) => {
                setCategory(v);
                resetPage();
              }}
              options={CATEGORIES.map((c) => c.name)}
              placeholder="All categories"
            />
            <FilterSelect
              label="Filter by district"
              value={district}
              onChange={(v) => {
                setDistrict(v);
                resetPage();
              }}
              options={DISTRICT_OPTIONS}
              placeholder="All districts"
            />
            <FilterSelect
              label="Filter by status"
              value={status}
              onChange={(v) => {
                setStatus(v);
                resetPage();
              }}
              options={STATUSES}
              placeholder="Any status"
            />
            <button
              onClick={() => {
                setCategory("");
                setDistrict("");
                setStatus("");
                setSearch("");
                resetPage();
              }}
              aria-label="Clear filters"
              className="grid size-10 place-items-center rounded-full bg-ink text-shell"
            >
              <XIcon className="size-4" />
            </button>
            <div className="ml-auto flex items-center gap-3">
              <button
                aria-label="Previous page"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                className="grid size-9 place-items-center rounded-full border border-line disabled:opacity-40"
              >
                <ChevronLeftIcon className="size-4" />
              </button>
              <span className="text-2xl font-semibold">
                {String(current + 1).padStart(2, "0")}
                <span className="text-sm text-ink-muted">
                  {" / "}
                  {String(pageCount).padStart(2, "0")} · {filtered.length} cases
                </span>
              </span>
              <button
                aria-label="Next page"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
                className="grid size-9 place-items-center rounded-full border border-line disabled:opacity-40"
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pageItems.map((c) => (
              <ComplaintCard key={c.id} complaint={c} color={colors[c.category]} isNew={newIds.includes(c.id)} />
            ))}
            {pageItems.length === 0 && <p className="text-ink-muted">No complaints match these filters.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
