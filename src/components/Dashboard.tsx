"use client";

// Home page dashboard. Layout and styling ported from the Lovable design (taipei-city-pulse);
// the logic is ours: complaints go through /api/triage (AI picks category + office), duplicates are
// grouped with groupCases(), and every case is drawn on the team's Leaflet map.

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Pick } from "@/components/map/CityMap";
import { MapWithLayers, useCategoryColors } from "@/components/map/MapWithLayers";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MicIcon,
  PinIcon,
  PulseIcon,
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

// Demo statuses: use the seed's own status when it has one (older reports are further along),
// otherwise a mix; the burst pipe is still new. Status is UI-only, not part of the shared Case type.
const SEED: Complaint[] = (seed as (Case & { status?: Status })[]).map((c, i) => ({
  ...c,
  status:
    c.status ?? (c.category === "Water pipe leak" && c.district === "Da'an" ? "New" : STATUSES[(i + 1) % 3]),
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

const MAX_DESCRIPTION = 3000;
const TRIAGE_TIMEOUT_MS = 30000;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// "11 Nov, 18:09" in Taipei time, built from parts so server and browser render identical text
// (toLocaleString's separators differ between engines and would break hydration).
function formatWhen(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Taipei",
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

// Shared hover/focus affordance for the dashboard's round buttons.
const BUTTON_FX = "transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime";

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
      setDescription((voicePrefix.current + text).slice(0, MAX_DESCRIPTION));
    };
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      setError("Voice input stopped. Check microphone permission, or type instead.");
    };
    recognizer.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Voice input could not start. Please type instead.");
    }
  }

  // Stop dictation without letting a late result overwrite the form after submit.
  function stopVoice() {
    const r = recognizer.current;
    if (!r) return;
    r.onresult = null;
    r.stop();
    recognizer.current = null;
    setListening(false);
  }

  async function submit() {
    stopVoice();
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
        signal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
      });
      const json = (res.headers.get("content-type") ?? "").includes("application/json") ? await res.json() : null;
      if (!res.ok || !json) throw new Error(json?.error ?? "Something went wrong. Please try again.");
      const data = json as TriageResponse;
      // The resident's explicit choices describe ONE problem. When the AI split the report into several
      // cases, they don't apply to all of them (parking + noise can't both be "Noise" at one spot).
      const single = data.cases.length === 1;
      const pickInTaipei = picked?.district ? picked : null; // a click outside the city is ignored
      const created: Complaint[] = data.cases.map((c) => ({
        ...c,
        ...(single && chosen && { category: chosen.name, office: chosen.office, typicalDaysToClose: chosen.typicalDaysToClose }),
        ...(single && district && { district }),
        ...(single && location.trim() && { locationText: location.trim() }),
        // A spot clicked on the map beats the typed district.
        ...(single && pickInTaipei && { lat: pickInTaipei.lat, lng: pickInTaipei.lng, district: pickInTaipei.district }),
        status: "New" as const,
        description: description.trim() || undefined,
      }));
      onCreated({ cases: created, mode: data.mode });
      setCategory("");
      setTitle("");
      setDistrict("");
      setLocation("");
      setDescription("");
      onClearPick();
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      setError(
        timedOut
          ? "The AI is taking too long. Please try again."
          : err instanceof Error && !(err instanceof SyntaxError)
            ? err.message
            : "Something went wrong. Please try again.",
      );
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
          maxLength={MAX_DESCRIPTION}
          placeholder="Describe the problem… mention every issue; the AI splits them into separate cases."
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
          "Optional: on the map below, click your district, then click the exact spot."
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
  const when = formatWhen(c.createdAt);
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
  const [category, setCategory] = useState("");
  const [district, setDistrict] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const mapRef = useRef<HTMLElement>(null);
  const { colors } = useCategoryColors(complaints);

  const filtered = useMemo(
    () =>
      complaints.filter(
        (c) =>
          (!category || c.category === category) &&
          (!district || c.district === district) &&
          (!status || c.status === status),
      ),
    [complaints, category, district, status],
  );

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

  // Real duplicate grouping (same rules as /api/group), computed once over ALL cases so the cards and
  // the map agree. The map gets the incidents that still have a member visible under the filters.
  const incidents = useMemo(() => groupCases(complaints), [complaints]);
  const mapIncidents = useMemo(() => {
    const shown = new Set(filtered.map((c) => c.id));
    return incidents.filter((i) => i.caseIds.some((id) => shown.has(id)));
  }, [incidents, filtered]);
  const top = incidents[0];
  const topDistrict = top ? complaints.find((c) => c.id === top.caseIds[0])?.district ?? null : null;

  function clearFilters() {
    setCategory("");
    setDistrict("");
    setStatus("");
    setPage(0);
  }

  const scrollToMap = () => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  function handleCreated({ cases, mode }: SubmitResult) {
    setComplaints((prev) => [...cases, ...prev]);
    setNewIds(cases.map((c) => c.id));
    setLastMode(mode);
    clearFilters(); // so filters can't hide the new cases
  }

  // Staff view: show just the biggest incident on the map and in the list.
  function focusIncident() {
    if (!top) return;
    setCategory(top.category);
    setDistrict(topDistrict ?? "");
    setStatus("");
    setPage(0);
    scrollToMap();
  }

  const created = complaints.filter((c) => newIds.includes(c.id));

  return (
    <div className="min-h-screen w-full bg-canvas p-3 font-pulse sm:p-6">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-shell text-ink shadow-shell">
        {/* ---- hero ---- */}
        <section className="bg-hero-glow relative p-5 sm:p-8">
          <Image
            src="/hero-city.jpg"
            alt=""
            fill
            priority
            sizes="(min-width: 1280px) 1280px, 100vw"
            className="pointer-events-none object-cover opacity-90 mix-blend-multiply"
          />
          <div className="relative">
            <header className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 font-bold tracking-wide">
                <PulseIcon className="size-6 shrink-0" /> CITYPULSE
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={scrollToMap}
                  className={cx("glass-dark rounded-full px-4 py-2 text-sm font-medium", BUTTON_FX)}
                >
                  Staff view · city map
                </button>
                <span
                  title="Taipei 1999 citizen hotline"
                  className="grid size-8 place-items-center rounded-full bg-lime text-xs font-bold text-lime-ink"
                >
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
                  <h2 className="text-lg">Report a problem</h2>
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
                        onClick={scrollToMap}
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
                  <h2 className="text-lg">Cases by status</h2>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {STATUSES.map((s, i) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStatus(status === s ? "" : s);
                          setPage(0);
                        }}
                        aria-pressed={status === s}
                        className={cx(
                          "rounded-full py-2 text-sm font-medium",
                          BUTTON_FX,
                          status === s ? "bg-lime text-lime-ink" : i === 0 ? "bg-shell" : "bg-ink/80 text-shell",
                        )}
                      >
                        <span className="text-xl font-semibold">{statusCounts[i]}</span> <span className="text-xs">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {top ? (
                  <button
                    type="button"
                    onClick={focusIncident}
                    title="Show this incident on the map"
                    className={cx("glass rounded-3xl p-5 text-left", BUTTON_FX)}
                  >
                    <h2>Grouped incident</h2>
                    <p className="mt-3 text-3xl font-semibold">
                      {top.caseIds.length}
                      <sup className="ml-1 text-xs">reports</sup>
                    </p>
                    <p className="text-xs">
                      {top.category}
                      {topDistrict ? ` · ${topDistrict}` : ""} · one incident, not {top.caseIds.length} tickets
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-shell/40">
                      <div className="hatch h-full" style={{ width: `${(top.caseIds.length / complaints.length) * 100}%` }} />
                    </div>
                  </button>
                ) : (
                  <div className="glass rounded-3xl p-5">
                    <h2>Grouped incident</h2>
                    <p className="mt-3 text-sm">No duplicate reports yet.</p>
                  </div>
                )}

                <div className="glass rounded-3xl p-5">
                  <div className="flex items-center justify-between">
                    <h2>By category</h2>
                    <span className="text-xs" title="Median days to close, averaged over the 1999 categories">
                      ~{avgDays}d to close
                    </span>
                  </div>
                  <div className="mt-3 flex h-16 items-end gap-2">
                    {byCategory.map((b) => {
                      const selected = category === b.name;
                      const highlighted = !category && b.name === top?.category;
                      return (
                        // Full-height button = big tap target; the visible bar sits inside it.
                        <button
                          key={b.name}
                          title={`${b.name}: ${b.n}`}
                          aria-label={`${b.name}: ${b.n} cases`}
                          aria-pressed={selected}
                          onClick={() => {
                            setCategory(selected ? "" : b.name);
                            setPage(0);
                          }}
                          className="flex h-full flex-1 items-end rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime"
                        >
                          <span
                            className={cx(
                              "block w-full rounded-full",
                              selected ? "bg-lime ring-2 ring-ink" : highlighted ? "bg-lime/80" : "bg-ink/80",
                            )}
                            style={{ height: `${Math.max(10, (b.n / maxCategory) * 100)}%` }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- map (staff view) ---- */}
        <section ref={mapRef} className="scroll-mt-4 p-5 sm:p-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold">
              Live city map <span className="text-base font-normal text-ink-muted">· staff view</span>
            </h2>
            <p className="text-xs text-ink-muted">
              {filtered.length} of {complaints.length} reports · {mapIncidents.length} grouped incident
              {mapIncidents.length === 1 ? "" : "s"} shown · click a district to zoom in
            </p>
          </div>
          <div className="rounded-3xl bg-canvas p-3 text-shell">
            <MapWithLayers
              cases={filtered}
              incidents={mapIncidents}
              highlightIds={newIds}
              picked={picked}
              onPick={setPicked}
            />
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
                setPage(0);
              }}
              options={CATEGORIES.map((c) => c.name)}
              placeholder="All categories"
            />
            <FilterSelect
              label="Filter by district"
              value={district}
              onChange={(v) => {
                setDistrict(v);
                setPage(0);
              }}
              options={DISTRICT_OPTIONS}
              placeholder="All districts"
            />
            <FilterSelect
              label="Filter by status"
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(0);
              }}
              options={STATUSES}
              placeholder="Any status"
            />
            <button
              onClick={clearFilters}
              aria-label="Clear filters"
              title="Clear filters"
              className={cx("grid size-10 place-items-center rounded-full bg-ink text-shell", BUTTON_FX)}
            >
              <XIcon className="size-4" />
            </button>
            <div className="ml-auto flex items-center gap-3">
              <button
                aria-label="Previous page"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                className={cx("grid size-9 place-items-center rounded-full border border-line disabled:opacity-40", BUTTON_FX)}
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
                className={cx("grid size-9 place-items-center rounded-full border border-line disabled:opacity-40", BUTTON_FX)}
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
