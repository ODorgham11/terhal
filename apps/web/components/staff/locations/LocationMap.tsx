/// <reference types="google.maps" />
"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconMapPinOff } from "@tabler/icons-react";
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  Map,
  Pin,
  useMap,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";

// The browser key for the Maps JavaScript API (restricted to the dashboard's domains in Google Cloud). Without it the
// map is left out and the coordinates are typed in.
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
// Advanced markers need a map ID; Google's demo one works until the company makes its own.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";
// Where the map opens for a place with no centre yet: all of Egypt, around Cairo.
const EGYPT = { lat: 30.0444, lng: 31.2357 };

type Point = { lat: number; lng: number };

type Props = {
  center: Point | null;
  // In metres; the circle around the pin.
  radius: number | null;
  // The pin was dragged or the map clicked: the new centre, rounded to about 10 cm.
  onMove: (center: Point) => void;
};

const round = (value: number) => Math.round(value * 1e6) / 1e6;

// A place's centre on Google Maps: drag the pin, or click anywhere to drop it there. The circle shows the radius trips
// are matched within. Typing new coordinates moves the pin, and the map follows it if it leaves the view.
export function LocationMap({ center, radius, onMove }: Props) {
  const t = useTranslations("staff.locations.map");
  const locale = useLocale();

  if (!KEY) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted">
        <IconMapPinOff aria-hidden className="size-4 shrink-0" stroke={1.75} />
        {t("unavailable")}
      </p>
    );
  }

  const move = (event: MapMouseEvent | google.maps.MapMouseEvent) => {
    const latLng = "detail" in event ? event.detail.latLng : event.latLng?.toJSON();
    if (latLng) onMove({ lat: round(latLng.lat), lng: round(latLng.lng) });
  };

  return (
    <APIProvider apiKey={KEY} language={locale} region="EG">
      <div className="flex flex-col gap-2">
        <div className="h-72 overflow-hidden rounded-xl border border-border">
          <Map
            mapId={MAP_ID}
            defaultCenter={center ?? EGYPT}
            defaultZoom={center ? 13 : 6}
            gestureHandling="cooperative"
            disableDefaultUI
            zoomControl
            fullscreenControl
            clickableIcons={false}
            onClick={move}
          >
            {center && (
              <>
                <AdvancedMarker position={center} draggable title={t("pin")} onDragEnd={move}>
                  <Pin background="#7a1a2c" borderColor="#641524" glyphColor="#ffffff" />
                </AdvancedMarker>
                {radius !== null && radius > 0 && (
                  <Circle
                    center={center}
                    radius={radius}
                    clickable={false}
                    strokeColor="#7a1a2c"
                    strokeOpacity={0.6}
                    strokeWeight={1.5}
                    fillColor="#7a1a2c"
                    fillOpacity={0.08}
                  />
                )}
              </>
            )}
            <Follow center={center} radius={radius} />
          </Map>
        </div>
        <p className="text-xs text-muted">{center ? t("hint") : t("hintEmpty")}</p>
      </div>
    </APIProvider>
  );
}

// Keeps the pin and its circle in view: fits them once when the map opens, then pans only when the pin leaves the
// view (typed coordinates), never while it's being dragged around inside it.
function Follow({ center, radius }: { center: Point | null; radius: number | null }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!map || !center) return;
    if (!fitted.current && radius) {
      fitted.current = true;
      const circle = new google.maps.Circle({ center, radius });
      const bounds = circle.getBounds();
      if (bounds) map.fitBounds(bounds, 24);
      return;
    }
    if (!map.getBounds()?.contains(center)) map.panTo(center);
  }, [map, center, radius]);

  return null;
}
