"use client";

import { useMemo, useState } from "react";
import categories from "@/data/categories.json";
import { groupCases } from "@/lib/group";
import type { Case, Incident } from "@/lib/types";
import type { Pick } from "./CityMap";
import { MapView } from "./MapView";

const PALETTE = ["#65a30d", "#2563eb", "#0891b2", "#7c3aed", "#db2777", "#a16207", "#dc2626", "#1e3a8a", "#ea580c", "#6b7280"];

type Props = {
  cases: Case[];
  incidents?: Incident[]; // omit to group duplicates automatically with groupCases()
  highlightIds?: string[]; // new cases: drawn bigger, and the map zooms to them
  picked?: Pick | null; // a location the resident chose by clicking the map
  onPick?: (pick: Pick) => void; // set to let residents click the map to choose a location
};

// Category names (categories.json first, so colours stay stable) and their colours.
// Exported so other UI (e.g. result cards) uses the same colour as the map.
export function useCategoryColors(cases: Case[]) {
  const names = useMemo(() => {
    const list = categories.map((c) => c.name);
    for (const c of cases) if (!list.includes(c.category)) list.push(c.category);
    return list;
  }, [cases]);
  const colors = useMemo(
    () => Object.fromEntries(names.map((n, i) => [n, PALETTE[i % PALETTE.length]])) as Record<string, string>,
    [names],
  );
  return { names, colors };
}

// The map plus a "Layers" panel to switch 1999 categories on and off. Import this on pages.
export function MapWithLayers({ cases, incidents: givenIncidents, highlightIds = [], picked, onPick }: Props) {
  const incidents = useMemo(() => givenIncidents ?? groupCases(cases), [givenIncidents, cases]);
  const { names, colors } = useCategoryColors(cases);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cases) m[c.category] = (m[c.category] ?? 0) + 1;
    return m;
  }, [cases]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = useMemo(() => new Set(names.filter((n) => !hidden.has(n))), [names, hidden]);
  const allOn = hidden.size === 0;
  const shown = cases.filter((c) => visible.has(c.category)).length;

  function toggle(name: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="h-[75vh] min-h-[480px] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <MapView
          cases={cases}
          incidents={incidents}
          highlightIds={highlightIds}
          colors={colors}
          visible={visible}
          picked={picked}
          onPick={onPick}
        />
      </div>

      <aside className="self-start overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p>
            <span className="font-semibold">Layers</span>
            <span className="ml-2 text-sm text-zinc-500">1999 categories</span>
          </p>
          <button
            onClick={() => setHidden(allOn ? new Set(names) : new Set())}
            className="rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {allOn ? "Clear" : "Select all"}
          </button>
        </div>
        <ul className="max-h-[50vh] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
          {names.map((name) => (
            <li key={name}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <input type="checkbox" checked={visible.has(name)} onChange={() => toggle(name)} className="size-4" />
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: colors[name] }} />
                <span className="flex-1 text-sm">{name}</span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {counts[name] ?? 0}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
          {shown} of {cases.length} reports shown
          {incidents.length > 0 &&
            ` · ${incidents.length} grouped incident${incidents.length > 1 ? "s" : ""}`}
        </p>
      </aside>
    </div>
  );
}
