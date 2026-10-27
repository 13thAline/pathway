import { densityColor } from "./analytics";
import { useEffect, useRef } from "react";
import type { Frame, Scenario } from "./types";
export function Venue({
  scenario,
  frame,
  zones = false,
  label = "Venue map",
  zoneOverlay,
  onZoneSelect,
}: {
  scenario: Scenario | null;
  frame: Frame | null;
  zones?: boolean;
  label?: string;
  zoneOverlay?: { id: string; value: number | null; maximum: number };
  onZoneSelect?: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => {
      const box = element.getBoundingClientRect(),
        dpr = window.devicePixelRatio || 1;
      element.width = Math.round(box.width * dpr);
      element.height = Math.round(box.height * dpr);
      const c = element.getContext("2d")!;
      c.scale(dpr, dpr);
      const w = box.width,
        h = box.height;
      c.fillStyle = "#f7f8f4";
      c.fillRect(0, 0, w, h);
      const scale = Math.min((w - 64) / 64, (h - 54) / 44),
        ox = (w - 60 * scale) / 2,
        oy = (h - 40 * scale) / 2;
      const xy = (p: number[]) => [ox + p[0] * scale, oy + (40 - p[1]) * scale];
      const path = (points: number[][]) => {
        c.beginPath();
        points.forEach((p, i) => {
          const [x, y] = xy(p);
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        });
        c.closePath();
      };
      const text = (
        text: string,
        p: number[],
        color = "#57655b",
        size = 10,
      ) => {
        const [x, y] = xy(p);
        c.fillStyle = color;
        c.font = `500 ${size}px "Geist Variable",sans-serif`;
        c.textAlign = "center";
        c.fillText(text, x, y);
      };
      c.strokeStyle = "#e8ece5";
      c.lineWidth = 0.6;
      for (let x = 0; x <= 60; x += 2) {
        const a = xy([x, 0]),
          b = xy([x, 40]);
        c.beginPath();
        c.moveTo(...(a as [number, number]));
        c.lineTo(...(b as [number, number]));
        c.stroke();
      }
      for (let y = 0; y <= 40; y += 2) {
        const a = xy([0, y]),
          b = xy([60, y]);
        c.beginPath();
        c.moveTo(...(a as [number, number]));
        c.lineTo(...(b as [number, number]));
        c.stroke();
      }
      if (!scenario) {
        text("Layout preview unavailable", [30, 22]);
        text(
          "Connect the local engine or load a saved example",
          [30, 18],
          "#6a766e",
          11,
        );
        return;
      }
      path(scenario.geometry.boundary);
      c.fillStyle = "#eff3eb";
      c.fill();
      c.strokeStyle = "#71816f";
      c.lineWidth = 1.4;
      c.stroke();
      const strip = scenario.zones.find((z) => z.id === "medical_access");
      if (strip) {
        path(strip.polygon);
        c.fillStyle = "#dce9d8";
        c.fill();
        text("RESERVED ACCESS · 4 m", [24, 36.6], "#526e4e", 9);
      }
      for (const ring of scenario.geometry.obstacles) {
        path(ring);
        c.fillStyle = "#d1d7c9";
        c.fill();
        c.strokeStyle = "#a9b49f";
        c.lineWidth = 1;
        c.stroke();
      }
      text("PANDAL", [40, 28.4], "#44553f", Math.min(12, scale * 1.5));
      text("Storage", [15, 7.2], "#5d6e57", 9);
      text("Facilities", [12, 26.4], "#5d6e57", 8);
      if (zones) {
        for (const z of scenario.zones) {
          path(z.polygon);
          c.fillStyle = "rgba(88,126,73,.035)";
          c.fill();
          c.setLineDash([3, 4]);
          c.strokeStyle = "#809a70";
          c.lineWidth = 0.8;
          c.stroke();
          c.setLineDash([]);
        }
      }
      if (zoneOverlay) {
        const selectedZone = scenario.zones.find(
          (z) => z.id === zoneOverlay.id,
        );
        if (selectedZone) {
          c.save();
          c.beginPath();
          for (const ring of [
            scenario.geometry.boundary,
            ...scenario.geometry.obstacles,
          ]) {
            ring.forEach((p, i) => {
              const [x, y] = xy(p);
              i ? c.lineTo(x, y) : c.moveTo(x, y);
            });
            c.closePath();
          }
          c.clip("evenodd");
          path(selectedZone.polygon);
          c.fillStyle = densityColor(zoneOverlay.value, zoneOverlay.maximum);
          c.globalAlpha = 0.8;
          c.fill();
          c.globalAlpha = 1;
          c.strokeStyle = "#6d28d9";
          c.lineWidth = 2;
          c.stroke();
          c.restore();
        }
      }
      for (const service of scenario.services) {
        const pts = service.positions.map(xy);
        c.beginPath();
        pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.setLineDash([3, 3]);
        c.strokeStyle = "#91a484";
        c.stroke();
        c.setLineDash([]);
        const [x, y] = pts[0];
        c.fillStyle = "#83977a";
        c.fillRect(x - 3, y - 3, 6, 6);
      }
      for (const line of scenario.lines) {
        const a = xy(line.points[0]),
          b = xy(line.points[1]);
        c.beginPath();
        c.moveTo(...(a as [number, number]));
        c.lineTo(...(b as [number, number]));
        c.strokeStyle = "#38754b";
        c.lineWidth = 4;
        c.stroke();
        text(
          line.id === "main_gate" ? "MAIN EXIT" : "EXIT 02",
          [54, line.points[0][1] - 1.8],
          "#386447",
          8,
        );
      }
      for (const entry of scenario.origins) {
        for (const p of entry.positions) {
          const [x, y] = xy(p);
          c.beginPath();
          c.arc(x, y, 3.1, 0, Math.PI * 2);
          c.fillStyle = "#39734c";
          c.fill();
        }
        text(
          `ENTRY ${entry.id}`,
          entry.id === "A" ? [5, 26.1] : [22, 3.5],
          "#39734c",
          9,
        );
      }
      for (const [id, x, y, state] of frame?.people ?? []) {
        void id;
        const p = xy([x, y]);
        c.beginPath();
        c.arc(p[0], p[1], Math.max(1.6, scale * 0.2), 0, Math.PI * 2);
        c.fillStyle =
          state === 1 ? "#b67832" : state === 2 ? "#263e30" : "#4c7b53";
        c.fill();
      }
      const a = xy([47, 3]),
        b = xy([57, 3]);
      c.beginPath();
      c.moveTo(...(a as [number, number]));
      c.lineTo(...(b as [number, number]));
      c.strokeStyle = "#71816f";
      c.lineWidth = 1;
      c.stroke();
      text("10 m", [52, 1], "#6a766e", 8);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    paint();
    return () => observer.disconnect();
  }, [scenario, frame, zones, zoneOverlay]);
  return (
    <canvas
      onClick={(e) => {
        if (!scenario || !onZoneSelect) return;
        const box = e.currentTarget.getBoundingClientRect();
        const scale = Math.min((box.width - 64) / 64, (box.height - 54) / 44);
        const x = (e.clientX - box.left - (box.width - 60 * scale) / 2) / scale;
        const y =
          40 - (e.clientY - box.top - (box.height - 40 * scale) / 2) / scale;
        const hits = scenario.zones.filter((z) => {
          let inside = false;
          for (
            let i = 0, j = z.polygon.length - 1;
            i < z.polygon.length;
            j = i++
          ) {
            const a = z.polygon[i],
              b = z.polygon[j];
            if (
              a[1] > y !== b[1] > y &&
              x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
            )
              inside = !inside;
          }
          return inside;
        });
        if (hits.length) {
          const previous = hits.findIndex((z) => z.id === zoneOverlay?.id);
          onZoneSelect(hits[(previous + 1) % hits.length].id);
        }
      }}
      ref={canvas}
      className="h-full w-full"
      role="img"
      aria-label={label}
    />
  );
}
