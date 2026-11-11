"use client";

import dynamic from "next/dynamic";

// Leaflet needs `window`, so the map only renders in the browser. Import THIS component, not CityMap.
export const MapView = dynamic(() => import("./CityMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />,
});
