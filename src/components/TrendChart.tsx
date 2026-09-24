"use client";

import { useState } from "react";
import { formatYen } from "@/lib/format";

type Point = { month: string; revenue: number; expense: number; profit: number };

// 検証済みカテゴリ配色の先頭3色(固定順)。文字には使わず、印(棒・線・凡例の色見本)だけに使う。
const SERIES = {
  revenue: { label: "売上", color: "#2a78d6" },
  expense: { label: "費用", color: "#eb6834" },
  profit: { label: "利益", color: "#1baf7a" },
} as const;

const W = 640;
const H = 260;
const PAD = { top: 16, right: 52, bottom: 28, left: 48 };
const BAR = 16;
const GAP = 2;
const RADIUS = 4;

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

function monthLabel(month: string) {
  return `${Number(month.slice(5))}月`;
}

function yearMonth(month: string) {
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
}

// 端だけ角を丸め、基準線側は四角にした棒(マイナスなら下向き)
function barPath(x: number, y0: number, y1: number, w: number) {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const r = Math.min(RADIUS, h, w / 2);
  if (y1 < y0) {
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

export function TrendChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.flatMap((d) => [d.revenue, d.expense, d.profit]);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min || 10_000);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * plotH;
  const cx = (i: number) => PAD.left + band * i + band / 2;
  const zero = y(0);
  const last = data[data.length - 1];
  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${cx(i)},${y(d.profit)}`).join(" ");
  const hovered = hover === null ? null : data[hover];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {Object.values(SERIES).map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            {s === SERIES.profit ? (
              <svg width="18" height="10" aria-hidden>
                <line x1="1" y1="5" x2="17" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                <circle cx="9" cy="5" r="3.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />
              </svg>
            ) : (
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            )}
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[560px]" role="img" aria-label="直近12か月の売上・費用・利益の推移">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#cbd5e1" : "#eef2f6"} strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px]">
                {axisLabel(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x0 = cx(i) - BAR - GAP / 2;
            return (
              <g key={d.month}>
                {hover === i && <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="#f1f5f9" />}
                <path d={barPath(x0, zero, y(d.revenue), BAR)} fill={SERIES.revenue.color} />
                <path d={barPath(x0 + BAR + GAP, zero, y(d.expense), BAR)} fill={SERIES.expense.color} />
                <text x={cx(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {monthLabel(d.month)}
                </text>
              </g>
            );
          })}

          <path d={linePath} fill="none" stroke={SERIES.profit.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <circle key={d.month} cx={cx(i)} cy={y(d.profit)} r={hover === i ? 5 : 4} fill={SERIES.profit.color} stroke="#fff" strokeWidth="2" />
          ))}
          <text x={cx(data.length - 1) + 10} y={y(last.profit)} dominantBaseline="middle" className="fill-slate-700 text-[11px] font-medium">
            {axisLabel(last.profit)}
          </text>

          {data.map((d, i) => (
            <rect
              key={d.month}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH + PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(i)}
            />
          ))}
        </svg>

        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg"
            style={{ left: `clamp(0px, calc(${(cx(hover) / W) * 100}% - 88px), calc(100% - 176px))` }}
          >
            <div className="mb-1 font-semibold text-slate-900">{yearMonth(hovered.month)}</div>
            {(["revenue", "expense", "profit"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2 py-0.5">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES[k].color }} />
                  {SERIES[k].label}
                </span>
                <span className="font-medium text-slate-900 tabular-nums">{formatYen(hovered[k])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer text-indigo-700 hover:underline">表で見る</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">月</th>
                <th className="py-1 pr-3 text-right font-medium">売上</th>
                <th className="py-1 pr-3 text-right font-medium">費用</th>
                <th className="py-1 text-right font-medium">利益</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.map((d) => (
                <tr key={d.month}>
                  <td className="py-1 pr-3">{yearMonth(d.month)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatYen(d.revenue)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatYen(d.expense)}</td>
                  <td className="py-1 text-right tabular-nums">{formatYen(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
