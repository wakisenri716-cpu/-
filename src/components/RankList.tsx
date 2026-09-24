import Link from "next/link";
import { formatYen } from "@/lib/format";
import type { RankItem } from "@/lib/dashboard";

// 横棒の順位表。棒は大きさだけを表す1色(文字は通常の文字色)で、金額は数字でも出す。
export function RankList({ items, color, empty }: { items: RankItem[]; color: string; empty: string }) {
  if (!items.length) return <p className="py-4 text-center text-sm text-slate-400">{empty}</p>;
  const max = Math.max(...items.map((i) => i.amount));
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <ol className="space-y-2.5">
      {items.map((item) => {
        const label = item.href ? (
          <Link href={item.href} className="hover:underline">
            {item.label}
          </Link>
        ) : (
          item.label
        );
        return (
          <li key={item.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{label}</span>
              <span className="shrink-0 tabular-nums text-slate-900">
                {formatYen(item.amount)}
                <span className="ml-1.5 text-xs text-slate-500">{Math.round((item.amount / total) * 100)}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100" aria-hidden>
              <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (item.amount / max) * 100)}%`, background: item.label === "その他" ? "#94a3b8" : color }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
