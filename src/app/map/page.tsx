import { MapView } from "@/components/map/MapView";
import { SAMPLE_CASES, SAMPLE_INCIDENTS } from "@/components/map/sample";

// Map preview with sample data. The home page will use <MapView> with real cases once triage is wired up.
export default function MapPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">CityPulse map</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {SAMPLE_CASES.length} reports · {SAMPLE_INCIDENTS.length} grouped incident
      </p>
      <div className="h-[70vh] min-h-[400px]">
        <MapView cases={SAMPLE_CASES} incidents={SAMPLE_INCIDENTS} highlightIds={["s1", "s2"]} />
      </div>
    </main>
  );
}
