import { MapDemo } from "@/components/map/MapDemo";

// Map-only view of the demo reports. The home page (ReportDesk) is the full resident flow.
export default function MapPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <div>
        <p className="text-sm font-medium text-rose-600">Taipei 1999 hotline</p>
        <h1 className="text-2xl font-semibold tracking-tight">CityPulse map</h1>
      </div>
      <MapDemo />
      <p className="text-xs text-zinc-500">
        District boundaries: Taipei City Department of Civil Affairs (data.taipei). Street locations: ©
        OpenStreetMap contributors.
      </p>
    </main>
  );
}
