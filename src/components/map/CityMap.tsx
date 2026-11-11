"use client";

import "leaflet/dist/leaflet.css";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from "react-leaflet";
import type { Case, Incident } from "@/lib/types";
import { locateCase, TAIPEI_CENTER } from "./locate";

const PALETTE = ["#e11d48", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

// Same category → same colour, without keeping a lookup table in sync with categories.json.
export function categoryColor(category: string): string {
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

type Props = {
  cases: Case[];
  incidents?: Incident[];
  highlightIds?: string[]; // e.g. the cases just created from the resident's complaint
};

export default function CityMap({ cases, incidents = [], highlightIds = [] }: Props) {
  // Cases that belong to an incident are drawn as part of the incident circle instead.
  const grouped = new Set(incidents.flatMap((i) => i.caseIds));

  return (
    <MapContainer center={TAIPEI_CENTER} zoom={12} scrollWheelZoom className="h-full w-full rounded-xl">
      {/* Esri street tiles label Taipei in English; OpenStreetMap's default tiles show Chinese names. */}
      <TileLayer
        attribution="Tiles &copy; Esri"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
      />

      {incidents.map((incident) => {
        const color = categoryColor(incident.category);
        const count = incident.caseIds.length;
        return (
          <Circle
            key={incident.id}
            center={[incident.lat, incident.lng]}
            radius={150 + count * 40}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.35, weight: 2 }}
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
        .filter((c) => !grouped.has(c.id))
        .map((c) => {
          const position = locateCase(c);
          if (!position) return null;
          const color = categoryColor(c.category);
          const highlighted = highlightIds.includes(c.id);
          return (
            <CircleMarker
              key={c.id}
              center={position}
              radius={highlighted ? 11 : 7}
              pathOptions={{ color: highlighted ? "#111827" : color, fillColor: color, fillOpacity: 0.9, weight: highlighted ? 3 : 1 }}
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
                  </>
                )}
              </Popup>
            </CircleMarker>
          );
        })}
    </MapContainer>
  );
}
