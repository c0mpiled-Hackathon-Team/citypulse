"use client";

import "leaflet/dist/leaflet.css";
import { DomEvent, latLngBounds, type Layer, type PathOptions } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { Circle, CircleMarker, GeoJSON, MapContainer, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import shapes from "@/data/district-shapes.json";
import type { Case, Incident } from "@/lib/types";
import { districtAt, geocode } from "./geocode";
import { findDistrict, locateCase, TAIPEI_BOUNDS } from "./locate";

// A location chosen by clicking the map. district is null when the click is outside Taipei.
export type Pick = { lat: number; lng: number; district: string | null };

// Zoom to the highlighted (just-created) cases once they have positions.
function FlyToHighlights({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const lastKey = useRef("");
  useEffect(() => {
    const key = positions.map((p) => p.join(",")).join(";");
    if (!positions.length || key === lastKey.current) return;
    lastKey.current = key;
    map.flyToBounds(latLngBounds(positions).pad(0.5), { maxZoom: 15, duration: 0.8 });
  }, [map, positions]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (pick: Pick) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng, district: districtAt(e.latlng.lat, e.latlng.lng) }) });
  return null;
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

  const grouped = new Set(incidents.flatMap((i) => i.caseIds));
  const colorOf = (category: string) => colors[category] ?? "#6b7280";
  const highlightPositions = cases
    .filter((c) => highlightIds.includes(c.id))
    .map((c) => geocoded[c.id] ?? locateCase(c))
    .filter((p): p is [number, number] => p !== null);

  return (
    <MapContainer
      bounds={TAIPEI_BOUNDS}
      zoomSnap={0.25}
      scrollWheelZoom
      className={`h-full w-full rounded-xl !bg-zinc-100 dark:!bg-zinc-900 ${onPick ? "cursor-crosshair" : ""}`}
    >
      <LocateButton />
      <FlyToHighlights positions={highlightPositions} />
      {onPick && <ClickToPick onPick={onPick} />}
      <GeoJSON
        data={shapes as GeoJSON.FeatureCollection}
        style={(feature) =>
          ({
            fillColor: DISTRICT_FILL[feature?.properties.name] ?? "#e5e7eb",
            fillOpacity: 0.85,
            color: "#ffffff",
            weight: 2,
          }) satisfies PathOptions
        }
        onEachFeature={(feature, layer: Layer) => {
          layer.bindTooltip(feature.properties.name, { permanent: true, direction: "center", className: "district-label" });
          layer.on({
            mouseover: (e) => e.target.setStyle({ weight: 4, fillOpacity: 1 }),
            mouseout: (e) => e.target.setStyle({ weight: 2, fillOpacity: 0.85 }),
          });
        }}
      />

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
        <CircleMarker
          center={[picked.lat, picked.lng]}
          radius={10}
          pathOptions={{ color: "#111827", fillColor: "#ffffff", fillOpacity: 1, weight: 3, dashArray: "3 3" }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            {picked.district ?? "Outside Taipei"}
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
