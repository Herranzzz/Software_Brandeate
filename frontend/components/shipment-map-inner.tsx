"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { ProvincePoint } from "./shipment-map";

type Point = ProvincePoint & { lat: number; lng: number; name: string };

type Props = {
  points: Point[];
};

const STATUS_COLORS = {
  exception:        "#ef4444",
  out_for_delivery: "#f59e0b",
  in_transit:       "#3b82f6",
  delivered:        "#22c55e",
  other:            "#94a3b8",
};

function getDominantColor(p: Point): string {
  if (p.exception > 0)                                  return STATUS_COLORS.exception;
  if (p.out_for_delivery > 0)                           return STATUS_COLORS.out_for_delivery;
  if (p.in_transit > 0)                                 return STATUS_COLORS.in_transit;
  if (p.delivered > 0)                                  return STATUS_COLORS.delivered;
  return STATUS_COLORS.other;
}

export default function ShipmentMapInner({ points }: Props) {
  // Patch Leaflet default icon paths (broken in Next.js)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require("leaflet");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    });
  }, []);

  const maxTotal = Math.max(...points.map((p) => p.total), 1);

  return (
    <MapContainer
      center={[40.4, -3.7]}
      className="smap-container"
      zoom={5}
      scrollWheelZoom={false}
      style={{ height: "420px", width: "100%", borderRadius: "12px" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {points.map((p) => {
        const radius = 8 + (p.total / maxTotal) * 28;
        const color = getDominantColor(p);

        return (
          <CircleMarker
            center={[p.lat, p.lng]}
            color={color}
            fillColor={color}
            fillOpacity={0.6}
            key={p.province_code}
            opacity={0.9}
            radius={radius}
            weight={2}
          >
            <Tooltip>
              <div className="smap-tooltip">
                <strong>{p.name} ({p.province_code})</strong>
                <div>{p.total} pedidos</div>
                {p.in_transit > 0       && <div>🚚 {p.in_transit} en tránsito</div>}
                {p.out_for_delivery > 0 && <div>🛵 {p.out_for_delivery} en reparto</div>}
                {p.delivered > 0        && <div>✅ {p.delivered} entregados</div>}
                {p.exception > 0        && <div>⚠️ {p.exception} excepciones</div>}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
