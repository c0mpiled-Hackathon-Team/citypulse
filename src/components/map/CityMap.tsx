"use client";

import "leaflet/dist/leaflet.css";
import { divIcon, DomEvent, geoJSON, latLngBounds, type LatLngBounds, type Layer, type PathOptions } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Pane, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import shapes from "@/data/district-shapes.json";
import type { Case, Incident } from "@/lib/types";
import { districtAt, geocode } from "./geocode";
import { findDistrict, locateCase, TAIPEI_BOUNDS } from "./locate";

// A location chosen by clicking the map. district is null when the click is outside Taipei.
export type Pick = { lat: number; lng: number; district: string | null };

// Marker for the picked spot: a rose dot with a pulsing ring (styled in globals.css).
const PICK_ICON = divIcon({
  className: "pick-marker",
  html: '<span class="pick-ring"></span><span class="pick-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Zoom to the highlighted (just-created) cases once they have positions.
function FlyToHighlights({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const lastKey = useRef("");
  useEffect(() => {
    const key = positions.map((p) => p.join(",")).join(";");
    if (!positions.length || key === lastKey.current) return;
    lastKey.current = key;
    map.flyToBounds(latLngBounds(positions).pad(0.5), { maxZoom: 14, duration: 0.8 });
  }, [map, positions]);
  return null;
}

// Bounds of each district shape, for zooming into a clicked district.
const DISTRICT_BOUNDS: Record<string, LatLngBounds> = Object.fromEntries(
  (shapes as GeoJSON.FeatureCollection).features.map((f) => [f.properties?.name, geoJSON(f).getBounds()]),
);

// Map clicks, like the issue tracker: a click on any district other than the one we're focused on
// flies into it. A click inside the focused district marks the exact spot (if picking is on).
function MapClicks({ onPick }: { onPick?: (pick: Pick) => void }) {
  const focused = useRef<string | null>(null);
  const map = useMapEvents({
    click: (e) => {
      const { lat, lng } = e.latlng;
      const district = districtAt(lat, lng);
      const bounds = district ? DISTRICT_BOUNDS[district] : undefined;
      const zoomedOut = bounds ? map.getZoom() < map.getBoundsZoom(bounds) - 0.5 : false;
      if (bounds && (district !== focused.current || zoomedOut)) {
        focused.current = district;
        map.flyToBounds(bounds, { duration: 0.7, padding: [20, 20] });
        return;
      }
      onPick?.({ lat, lng, district });
    },
    // Back at (or near) the full-city view: no district is focused any more.
    zoomend: () => {
      if (map.getZoom() <= map.getBoundsZoom(TAIPEI_BOUNDS) + 0.5) focused.current = null;
    },
  });
  return null;
}

// "Full city" button under the zoom controls. Only shown once the map is zoomed in past the whole-Taipei view.
function FullCityButton() {
  const map = useMap();
  const fitZoom = () => map.getBoundsZoom(TAIPEI_BOUNDS);
  const [zoomedIn, setZoomedIn] = useState(false);
  useMapEvents({ zoomend: () => setZoomedIn(map.getZoom() > fitZoom() + 0.5) });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) DomEvent.disableClickPropagation(ref.current);
  }, []);
  return (
    <div ref={ref} className={`absolute left-[10px] top-[84px] z-[1000] ${zoomedIn ? "" : "hidden"}`}>
      <button
        type="button"
        onClick={() => map.flyToBounds(TAIPEI_BOUNDS, { duration: 0.8 })}
        className="rounded-md border-2 border-black/20 bg-white px-2.5 py-1 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
      >
        ← Full city
      </button>
    </div>
  );
}

// "Where am I" button, top-right of the map.
function LocateButton() {
  const map = useMap();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Leaflet listens on the map container natively, so React's stopPropagation is too late:
  // without this, clicking the button would also count as a click on the map.
  useEffect(() => {
    if (ref.current) DomEvent.disableClickPropagation(ref.current);
  }, []);
  return (
    <div className="leaflet-top leaflet-right">
      <div ref={ref} className="leaflet-control leaflet-bar">
        <button
          type="button"
          title="Show my location"
          aria-label="Show my location"
          disabled={busy}
          onClick={() => {
            if (!navigator.geolocation) return;
            setBusy(true);
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setBusy(false);
                map.flyTo([pos.coords.latitude, pos.coords.longitude], 15);
              },
              () => setBusy(false),
              { timeout: 8000 },
            );
          }}
          className="flex size-[34px] items-center justify-center bg-white text-lg text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          ◎
        </button>
      </div>
    </div>
  );
}

// Soft district fills (lavender, mint, sand, slate). Neighbouring districts never share a colour.
const LAVENDER = "#c7d2fe", MINT = "#a7f3d0", SAND = "#fde68a", SLATE = "#cbd5e1";
const DISTRICT_FILL: Record<string, string> = {
  Beitou: LAVENDER, Shilin: MINT, Neihu: SAND, Datong: LAVENDER, Zhongshan: SLATE, Songshan: LAVENDER,
  Zhongzheng: MINT, "Da'an": SAND, Xinyi: MINT, Nangang: SLATE, Wanhua: SAND, Wenshan: LAVENDER,
};

type Props = {
  cases: Case[];
  incidents?: Incident[];
  highlightIds?: string[];
  colors: Record<string, string>; // category → colour, shared with the layers panel
  visible: Set<string>; // categories currently switched on
  picked?: Pick | null;
  onPick?: (pick: Pick) => void;
};

export default function CityMap({ cases, incidents = [], highlightIds = [], colors, visible, picked, onPick }: Props) {
  // Street-level positions found by geocoding, keyed by case id.
  const [geocoded, setGeocoded] = useState<Record<string, [number, number]>>({});

  useEffect(() => {
    let cancelled = false;
    for (const c of cases) {
      if (c.lat != null || !c.locationText || geocoded[c.id]) continue;
      // Text that only names a district gains nothing from geocoding.
      if (findDistrict(c.locationText)) continue;
      geocode(c.locationText, findDistrict(c.district)?.name ?? null).then((pos) => {
        if (pos && !cancelled) setGeocoded((prev) => ({ ...prev, [c.id]: pos }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the case list changes
  }, [cases]);

  // District under the mouse, for the lift effect's info box.
  const [hovered, setHovered] = useState<string | null>(null);
  const perDistrict: Record<string, number> = {};
  for (const c of cases) {
    const d = findDistrict(c.district)?.name;
    if (d && visible.has(c.category)) perDistrict[d] = (perDistrict[d] ?? 0) + 1;
  }

  const grouped = new Set(incidents.flatMap((i) => i.caseIds));
  const colorOf = (category: string) => colors[category] ?? "#6b7280";
  // A new case that joined an incident is drawn as part of that incident, so fly there instead.
  const highlightPositions = cases
    .filter((c) => highlightIds.includes(c.id))
    .map((c): [number, number] | null => {
      const incident = incidents.find((i) => i.caseIds.includes(c.id));
      return incident ? [incident.lat, incident.lng] : (geocoded[c.id] ?? locateCase(c));
    })
    .filter((p): p is [number, number] => p !== null);

  return (
    <MapContainer
      bounds={TAIPEI_BOUNDS}
      zoomSnap={0.25}
      scrollWheelZoom
      className={`h-full w-full rounded-xl !bg-zinc-100 dark:!bg-zinc-900 ${onPick ? "cursor-crosshair" : ""}`}
    >
      <LocateButton />
      <FullCityButton />
      <FlyToHighlights positions={highlightPositions} />
      <MapClicks onPick={onPick} />
      {/* Districts get their own pane below the pins, so a lifted district never covers a pin. */}
      <Pane name="districts" style={{ zIndex: 350 }}>
        <GeoJSON
          data={shapes as GeoJSON.FeatureCollection}
          style={(feature) =>
            ({
              fillColor: DISTRICT_FILL[feature?.properties.name] ?? "#e5e7eb",
              fillOpacity: 0.9,
              color: "#ffffff",
              weight: 2,
            }) satisfies PathOptions
          }
          onEachFeature={(feature, layer: Layer) => {
            layer.bindTooltip(feature.properties.name, { permanent: true, direction: "center", className: "district-label" });
            layer.on({
              // The lift itself is CSS (.district-hot in globals.css); bringToFront keeps the raised
              // district's shadow on top of its neighbours.
              mouseover: (e) => {
                e.target.bringToFront();
                e.target.getElement()?.classList.add("district-hot");
                setHovered(feature.properties.name);
              },
              mouseout: (e) => {
                e.target.getElement()?.classList.remove("district-hot");
                setHovered(null);
              },
            });
          }}
        />
      </Pane>

      <div className="leaflet-bottom leaflet-left">
        <div className="leaflet-control rounded-lg bg-white/95 px-3 py-2 text-sm shadow-md dark:bg-zinc-900/95">
          {hovered ? (
            <>
              <span className="font-semibold">{hovered}</span>
              <span className="ml-2 text-zinc-500">
                {perDistrict[hovered] ?? 0} report{perDistrict[hovered] === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <span className="text-zinc-500">Hover a district</span>
          )}
        </div>
      </div>

      {incidents
        .filter((incident) => visible.has(incident.category))
        .map((incident) => {
          const color = colorOf(incident.category);
          const count = incident.caseIds.length;
          return (
            <Circle
              key={incident.id}
              center={[incident.lat, incident.lng]}
              radius={150 + count * 40}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.45, weight: 3 }}
            >
              <Tooltip permanent direction="center" className="incident-label">
                {count}
              </Tooltip>
              <Popup>
                <strong>{incident.category}</strong>
                <br />
                {count} reports grouped into one incident
              </Popup>
            </Circle>
          );
        })}

      {cases
        .filter((c) => !grouped.has(c.id) && visible.has(c.category))
        .map((c) => {
          const position = geocoded[c.id] ?? locateCase(c);
          if (!position) return null;
          const color = colorOf(c.category);
          const highlighted = highlightIds.includes(c.id);
          return (
            <CircleMarker
              key={c.id}
              center={position}
              radius={highlighted ? 11 : 8}
              pathOptions={{ color: highlighted ? "#111827" : "#ffffff", fillColor: color, fillOpacity: 1, weight: highlighted ? 3 : 2 }}
            >
              <Popup>
                <strong>{c.category}</strong>
                <br />
                {c.summary}
                <br />
                <span style={{ color: "#6b7280" }}>
                  {c.office}
                  {c.typicalDaysToClose != null && ` · usually ~${c.typicalDaysToClose} days`}
                </span>
                {c.locationText && (
                  <>
                    <br />
                    📍 {c.locationText}
                    {!geocoded[c.id] && c.lat == null && " (approximate)"}
                  </>
                )}
              </Popup>
            </CircleMarker>
          );
        })}

      {picked && (
        <Marker position={[picked.lat, picked.lng]} icon={PICK_ICON} interactive={false}>
          <Tooltip permanent direction="top" offset={[0, -12]} className="pick-label">
            📍 {picked.district ?? "Outside Taipei"}
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
