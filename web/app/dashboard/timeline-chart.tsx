"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clock, dayOf, dayShort, type Stats } from "@/lib/stats";

const DEFAULT_HEIGHT = 250; // the whole box: plot + the band the x labels sit in
const M = { top: 14, right: 46, bottom: 30, left: 38 };
const DAY = 86_400_000;

/** A round step so the y axis lands on 0 / 25 / 50 style numbers. */
function niceStep(max: number, ticks = 4) {
  const raw = Math.max(1, max / ticks);
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/**
 * How many people have handed in a gift by each hour (or day): one series, so one color and no legend.
 * Thin line, soft area wash, a ringed end marker with its value, and a hover/keyboard readout that snaps to a slot.
 */
export default function TimelineChart({ timeline, total, height = DEFAULT_HEIGHT }: { timeline: Stats["timeline"]; total: number; height?: number }) {
  const HEIGHT = height;
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const { points, slotMs, start } = timeline;
  const last = points[points.length - 1];
  const daily = slotMs >= DAY;
  const spansDays = !!last && dayOf(start) !== dayOf(last.at); // crosses midnight: say which day

  // scales
  const x0 = start;
  const x1 = last ? Math.max(last.at, x0 + 3_600_000) : x0 + 3_600_000;
  const step = niceStep(total, 5); // 105 people -> 0 / 25 / ... / 125, not a 150 top that wastes the plot
  const yMax = Math.max(step, Math.ceil(total / step) * step);
  const pw = Math.max(10, w - M.left - M.right);
  const ph = HEIGHT - M.top - M.bottom;
  const X = (t: number) => M.left + ((t - x0) / (x1 - x0)) * pw;
  const Y = (v: number) => M.top + ph - (v / yMax) * ph;

  // the line: 0 at the very start, then the running total at the end of every slot
  const pts = last ? [{ x: X(x0), y: Y(0) }, ...points.map((p) => ({ x: X(p.at), y: Y(p.cumulative) }))] : [];
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  const area = pts.length ? `${line}L${pts[pts.length - 1].x.toFixed(1)},${Y(0)}L${pts[0].x.toFixed(1)},${Y(0)}Z` : "";

  // y ticks
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);

  // x ticks: at slot starts, thinned so labels never touch
  const labelW = daily ? 46 : spansDays ? 78 : 44;
  const every = Math.max(1, Math.ceil((labelW + 12) / Math.max(1, (pw * slotMs) / (x1 - x0))));
  const xTicks = points.filter((_, i) => i % every === 0).map((p) => p.from);
  const tickLabel = (t: number) => {
    if (daily) return dayShort(t);
    return spansDays && (clock(t) === "00:00" || t === xTicks[0]) ? `${dayShort(t)} ${clock(t)}` : clock(t);
  };

  const slotLabel = (i: number) => {
    const p = points[i];
    if (daily) return dayOf(p.from);
    return `${spansDays ? dayShort(p.from) + " " : ""}${clock(p.from)}–${clock(p.at)}`;
  };

  const nearest = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(X(p.at) - px);
      if (d < dist) [best, dist] = [i, d];
    });
    return best;
  };
  const onMove = (e: PointerEvent) => points.length && setActive(nearest(e.clientX));
  const onKey = (e: KeyboardEvent) => {
    if (!points.length) return;
    const cur = active ?? points.length - 1;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(points.length - 1, Math.max(0, next)));
  };

  const a = active !== null ? points[active] : null;
  const ax = a ? X(a.at) : 0;
  const tipLeft = a ? Math.min(Math.max(ax, 80), Math.max(80, w - 80)) : 0;

  return (
    <div
      ref={box}
      className="tl"
      style={{ height: HEIGHT }}
      tabIndex={0}
      role="group"
      aria-label={`กราฟจำนวนคนที่ส่งสะสมตามเวลา ใช้ปุ่มลูกศรซ้ายขวาเพื่อดูแต่ละช่วง${last ? ` ตอนนี้ ${last.cumulative} จาก ${total} คน` : ""}`}
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setActive(null)}
      onKeyDown={onKey}
      onFocus={() => active === null && points.length && setActive(points.length - 1)}
      onBlur={() => setActive(null)}
    >
      {w > 0 && (
        <svg width={w} height={HEIGHT} role="img" aria-hidden="true">
          {/* grid and y labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={M.left + pw} y1={Y(v)} y2={Y(v)} className="tl-grid" />
              <text x={M.left - 8} y={Y(v)} dy="0.32em" textAnchor="end" className="tl-axis">
                {v}
              </text>
            </g>
          ))}
          {/* the whole group: where the line is heading */}
          <line x1={M.left} x2={M.left + pw} y1={Y(total)} y2={Y(total)} className="tl-total" />
          <text x={M.left + 4} y={Y(total) - 5} className="tl-axis">
            ทั้งหมด {total} คน
          </text>

          {/* x labels */}
          {xTicks.map((t) => (
            <text key={t} x={X(t)} y={HEIGHT - 8} textAnchor="middle" className="tl-axis">
              {tickLabel(t)}
            </text>
          ))}

          {last && (
            <>
              <path d={area} className="tl-area" />
              <path d={line} className="tl-line" pathLength={1} />
              {/* end marker: 8px dot with a 2px surface ring, value beside it */}
              <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={6} className="tl-ring" />
              <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={4} className="tl-dot" />
              <text x={pts[pts.length - 1].x + 11} y={pts[pts.length - 1].y} dy="0.32em" className="tl-end">
                {last.cumulative}
              </text>
            </>
          )}

          {/* crosshair + the slot being read */}
          {a && (
            <>
              <line x1={ax} x2={ax} y1={M.top} y2={M.top + ph} className="tl-cross" />
              <circle cx={ax} cy={Y(a.cumulative)} r={6} className="tl-ring" />
              <circle cx={ax} cy={Y(a.cumulative)} r={4} className="tl-dot" />
            </>
          )}
        </svg>
      )}

      {a && (
        <div className="tl-tip" style={{ left: tipLeft, top: M.top }} role="status">
          <strong>
            <i className="tl-key" aria-hidden="true" />
            รวม {a.cumulative} คน
          </strong>
          <span>
            {slotLabel(active!)}
          </span>
          <span>{a.added > 0 ? `ช่วงนี้ส่งเพิ่ม ${a.added} คน` : "ช่วงนี้ยังไม่มีคนส่ง"}</span>
        </div>
      )}
    </div>
  );
}
