"use client";

import { useEffect, useRef, useState } from "react";
import Globe from "react-globe.gl";
import type { ProvincePoint } from "./shipment-globe";

type Point = ProvincePoint & { lat: number; lng: number; name: string };

type Props = { points: Point[] };

// Warehouse origin — Madrid
const ORIGIN = { lat: 40.42, lng: -3.70 };

const STATUS_COLOR: Record<string, string> = {
  exception:        "#ef4444",
  out_for_delivery: "#f59e0b",
  in_transit:       "#3b82f6",
  delivered:        "#22c55e",
  other:            "#a78bfa",
};

function getDominantColor(p: Point): string {
  if (p.exception > 0)                                  return STATUS_COLOR.exception;
  if (p.out_for_delivery > 0)                           return STATUS_COLOR.out_for_delivery;
  if (p.in_transit > 0)                                 return STATUS_COLOR.in_transit;
  if (p.delivered > 0)                                  return STATUS_COLOR.delivered;
  return STATUS_COLOR.other;
}

export default function ShipmentGlobeInner({ points }: Props) {
  const globeRef = useRef<{ pointOfView: (pov: object, ms?: number) => void } | null>(null);
  const [size, setSize] = useState({ w: 640, h: 480 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive size
  useEffect(() => {
    function update() {
      if (containerRef.current) {
        setSize({ w: containerRef.current.offsetWidth, h: Math.min(containerRef.current.offsetWidth * 0.7, 520) });
      }
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Point-of-view to Spain after mount
  useEffect(() => {
    const timeout = setTimeout(() => {
      globeRef.current?.pointOfView({ lat: 40, lng: -3, altitude: 1.2 }, 1200);
    }, 600);
    return () => clearTimeout(timeout);
  }, []);

  const maxTotal = Math.max(...points.map((p) => p.total), 1);

  // Arcs: warehouse → each province
  const arcs = points.map((p) => ({
    startLat: ORIGIN.lat,
    startLng: ORIGIN.lng,
    endLat: p.lat,
    endLng: p.lng,
    color: getDominantColor(p),
    label: `${p.name}: ${p.total} pedidos`,
    value: p.total,
  }));

  // Ring markers at each province
  const rings = points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    maxR: 0.6 + (p.total / maxTotal) * 1.8,
    propagationSpeed: 1.5,
    repeatPeriod: 900 + Math.random() * 400,
    color: getDominantColor(p),
  }));

  // Labels
  const labels = points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    text: `${p.name}\n${p.total}`,
    color: "#ffffff",
    size: 0.5 + (p.total / maxTotal) * 0.5,
  }));

  return (
    <div ref={containerRef} className="sglobe-container">
      <Globe
        ref={globeRef as React.RefObject<never>}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        atmosphereColor="#6366f1"
        atmosphereAltitude={0.18}

        // Arcs: warehouse → province
        arcsData={arcs}
        arcColor="color"
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={1800}
        arcStroke={0.4}
        arcAltitudeAutoScale={0.3}
        arcLabel="label"

        // Rings at destination
        ringsData={rings}
        ringColor="color"
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"

        // Labels
        labelsData={labels}
        labelText="text"
        labelSize="size"
        labelColor="color"
        labelResolution={2}
        labelAltitude={0.01}
      />
    </div>
  );
}
