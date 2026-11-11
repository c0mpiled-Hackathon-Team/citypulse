"use client";

import { useState } from "react";
import type { Pick } from "./CityMap";
import { MapWithLayers } from "./MapWithLayers";
import { SAMPLE_CASES } from "./sample";

// /map preview: sample reports, automatic grouping, and click-to-pick.
export function MapDemo() {
  const [picked, setPicked] = useState<Pick | null>(null);
  return (
    <>
      <MapWithLayers cases={SAMPLE_CASES} picked={picked} onPick={setPicked} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {picked
          ? `Picked: ${picked.district ?? "outside Taipei"} (${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)})`
          : "Click the map to choose a location for a new report."}
      </p>
    </>
  );
}
