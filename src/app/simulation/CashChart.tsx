"use client";

import { useState } from "react";
import { formatYen } from "@/lib/format";

type Point = { month: string; cash: number; baseCash: number };

// 現預金の見込み(もしも / いまのまま)。色は印だけに使い、文字は文字の色で書く
const SERIES = {
  cash: { label: "もしもの場合", color: "#3b5a94" },
  baseCash: { label: "いまのまま", color: "#8f99ab" },
} as const;
const W = 640;
const H = 240;
const PAD = { top: 16, right: 64, bottom: 28, left: 56 };

function niceStep(range: number) {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
const axis = (v: number) => (v === 0 ? "0" : Math.abs(v) >= 10_000 ? `${(v / 10_000).toLocaleString("ja-JP")}万` : v.toLocaleString("ja-JP"));
const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

export function CashChart({ data, start }: { data: Point[]; start: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = [start, ...data.flatMap((d) => [d.cash, d.baseCash])];
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min || 100_000);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * plotH;
  const path = (k: "cash" | "baseCash") => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[k])}`).join(" ");
  const last = data[data.length - 1];
  const h = hover === null ? null : data[hover];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        {(Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg width="18" height="10" aria-hidden>
              <line x1="1" y1="5" x2="17" y2="5" stroke={SERIES[k].color} strokeWidth="2" strokeDasharray={k === "baseCash" ? "4 3" : undefined} strokeLinecap="round" />
            </svg>
            {SERIES[k].label}
          </span>
        ))}
      </div>
      <div className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[520px]" role="img" aria-label="これから12か月の現預金の見込み">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#f43f5e" : "#e4e7ec"} strokeWidth="1" strokeDasharray={t === 0 ? "3 3" : undefined} />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px]">
                {axis(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <g key={d.month}>
              {hover === i && <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="#e4e7ec" />}
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                {Number(d.month.slice(5))}月
              </text>
            </g>
          ))}
          <path d={path("baseCash")} fill="none" stroke={SERIES.baseCash.color} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
          <path d={path("cash")} fill="none" stroke={SERIES.cash.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <circle key={d.month} cx={x(i)} cy={y(d.cash)} r={hover === i ? 5 : 3.5} fill={d.cash < 0 ? "#e11d48" : SERIES.cash.color} stroke="#fff" strokeWidth="1.5" />
          ))}
          <text x={x(data.length - 1) + 8} y={y(last.cash)} dominantBaseline="middle" className="fill-slate-700 text-[11px] font-medium">
            {axis(last.cash)}
          </text>
          <text x={x(data.length - 1) + 8} y={y(last.baseCash) + (Math.abs(y(last.baseCash) - y(last.cash)) < 12 ? 12 : 0)} dominantBaseline="middle" className="fill-slate-500 text-[11px]">
            {axis(last.baseCash)}
          </text>
          {data.map((d, i) => (
            <rect key={d.month} x={PAD.left + band * i} y={PAD.top} width={band} height={plotH + PAD.bottom} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)} />
          ))}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg" style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 88px), calc(100% - 176px))` }}>
            <div className="mb-1 font-semibold text-slate-900">{ym(h.month)}末</div>
            {(Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => (
              <div key={k} className="flex justify-between gap-2 py-0.5">
                <span className="text-slate-600">{SERIES[k].label}</span>
                <span className="font-medium text-slate-900 tabular-nums">{formatYen(h[k])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
