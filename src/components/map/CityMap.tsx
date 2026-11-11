"use client";

import "leaflet/dist/leaflet.css";
import type { Layer, PathOptions } from "leaflet";
import { useEffect, useState } from "react";
import { Circle, CircleMarker, GeoJSON, MapContainer, Popup, Tooltip } from "react-leaflet";
import shapes from "@/data/district-shapes.json";
import type { Case, Incident } from "@/lib/types";
import { geocode } from "./geocode";
import { findDistrict, locateCase, TAIPEI_BOUNDS } from "./locate";

// Pastel district fills, like the city's own district maps. Neighbouring districts get different colours.
const DISTRICT_FILL: Record<string, string> = {
  Beitou: "#f9a8d4", Shilin: "#fdba74", Neihu: "#7dd3fc", Datong: "#7dd3fc", Zhongshan: "#d9f99d",
  Songshan: "#f9a8d4", Zhongzheng: "#f9a8d4", "Da'an": "#fdba74", Xinyi: "#d9f99d", Wanhua: "#d9f99d",
  Nangang: "#fef3c7", Wenshan: "#7dd3fc",
};

type Props = {
  cases: Case[];
  incidents?: Incident[];
  highlightIds?: string[];
  colors: Record<string, string>; // category → colour, shared with the layers panel
  visible: Set<string>; // categories currently switched on
};

export default function CityMap({ cases, incidents = [], highlightIds = [], colors, visible }: Props) {
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

  return (
    <MapContainer
      bounds={TAIPEI_BOUNDS}
      zoomSnap={0.25}
      scrollWheelZoom
      className="h-full w-full rounded-xl !bg-zinc-100 dark:!bg-zinc-900"
    >
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
    </MapContainer>
  );
}
