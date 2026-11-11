"use client";

import { useState } from "react";
import seed from "@/data/seed.json";
import type { Case } from "@/lib/types";
import type { Pick } from "./CityMap";
import { MapWithLayers } from "./MapWithLayers";

// /map preview: the team's demo reports, automatic grouping, and click-to-pick.
export function MapDemo() {
  const [picked, setPicked] = useState<Pick | null>(null);
  return (
    <>
      <MapWithLayers cases={seed as Case[]} picked={picked} onPick={setPicked} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {picked
          ? `Picked: ${picked.district ?? "outside Taipei"} (${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)})`
          : "Click the map to choose a location for a new report."}
      </p>
    </>
  );
}
