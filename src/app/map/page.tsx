import { MapWithLayers } from "@/components/map/MapWithLayers";
import { SAMPLE_CASES, SAMPLE_INCIDENTS } from "@/components/map/sample";

// Map preview with sample data. The home page will use <MapWithLayers> with real cases once triage is wired up.
export default function MapPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <div>
        <p className="text-sm font-medium text-rose-600">Taipei 1999 hotline</p>
        <h1 className="text-2xl font-semibold tracking-tight">CityPulse map</h1>
      </div>
      <MapWithLayers cases={SAMPLE_CASES} incidents={SAMPLE_INCIDENTS} highlightIds={["s1", "s2"]} />
      <p className="text-xs text-zinc-500">
        District boundaries: Taipei City Department of Civil Affairs (data.taipei). Street locations: ©
        OpenStreetMap contributors.
      </p>
    </main>
  );
}
