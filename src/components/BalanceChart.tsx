"use client";

import { useRef, useState } from "react";
import { formatYen } from "@/lib/format";

// 総勘定元帳の残高推移(1系列)。日ごとの最終残高を、残高が変わるまで横に伸ばす階段状の線で描く。
// 系列は1つなので凡例は出さず、見出しで何の線かを示す。数字は下の元帳の表でも確認できる。

type Point = { date: string; balance: number };

const COLOR = "#2a78d6";
const W = 640;
const H = 200;
const PAD = { top: 14, right: 16, bottom: 26, left: 52 };
const DAY = 86_400_000;

function niceStep(range: number) {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function axisLabel(v: number) {
  if (v === 0) return "0";
  return Math.abs(v) >= 10_000 ? `${(v / 10_000).toLocaleString("ja-JP")}万` : v.toLocaleString("ja-JP");
}

function shortDate(key: string, withYear: boolean) {
  const [y, m, d] = key.split("-").map(Number);
  return withYear ? `${y}/${m}/${d}` : `${m}/${d}`;
}

export function BalanceChart({ points, label }: { points: Point[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (points.length < 2) return null;

  const t = (key: string) => Date.parse(`${key}T00:00:00Z`);
  const t0 = t(points[0].date);
  const t1 = Math.max(t(points[points.length - 1].date), t0 + DAY);
  const values = points.map((p) => p.balance);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min || 10_000);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (key: string) => PAD.left + ((t(key) - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * plotH;
  const path = points
    .map((p, i) => (i === 0 ? `M${x(p.date)},${y(p.balance)}` : `H${x(p.date)} V${y(p.balance)}`))
    .join(" ");

  const multiYear = points[0].date.slice(0, 4) !== points[points.length - 1].date.slice(0, 4);
  const labelCount = Math.min(5, points.length);
  const labelIdx = [...new Set(Array.from({ length: labelCount }, (_, i) => Math.round((i * (points.length - 1)) / Math.max(1, labelCount - 1))))];

  function pick(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    setHover(best);
  }

  const hovered = hover === null ? null : points[hover];

  return (
    <div className="border-b px-4 py-3">
      <div className="mb-1 text-xs font-medium text-slate-600">{label}の残高の推移</div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full touch-pan-y"
          role="img"
          aria-label={`${label}の残高の推移`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#cbd5e1" : "#eef2f6"} strokeWidth="1" />
              <text x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px]">
                {axisLabel(v)}
              </text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text
              key={i}
              x={x(points[i].date)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-slate-500 text-[11px]"
            >
              {shortDate(points[i].date, multiYear)}
            </text>
          ))}
          {hovered && <line x1={x(hovered.date)} x2={x(hovered.date)} y1={PAD.top} y2={PAD.top + plotH} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />}
          <path d={path} fill="none" stroke={COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hovered && <circle cx={x(hovered.date)} cy={y(hovered.balance)} r="4.5" fill={COLOR} stroke="#fff" strokeWidth="2" />}
          <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" />
        </svg>
        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-40 rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-lg"
            style={{ left: `clamp(0px, calc(${(x(hovered.date) / W) * 100}% - 80px), calc(100% - 160px))` }}
          >
            <div className="font-semibold text-slate-900">{shortDate(hovered.date, true)}</div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: COLOR }} />
                残高
              </span>
              <span className="font-medium text-slate-900 tabular-nums">{formatYen(hovered.balance)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
