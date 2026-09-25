import Link from "next/link";
import { PRESETS, type Period } from "@/lib/accounting/period";

const chip = "rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap";

// 期間の切り替え。リンクとGETフォームだけで動くので、サーバー側で描画した帳票ページにそのまま置ける。
export function PeriodPicker({ path, period }: { path: string; period: Period }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm print:hidden">
      <span className="text-xs text-slate-500">期間</span>
      {PRESETS.map((p) => (
        <Link
          key={p.key}
          href={`${path}?preset=${p.key}`}
          className={`${chip} ${period.preset === p.key ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
        >
          {p.label}
        </Link>
      ))}
      <form action={path} className="flex flex-wrap items-center gap-1 text-xs">
        <input type="hidden" name="preset" value="custom" />
        <input type="date" name="from" defaultValue={period.from ?? ""} className="rounded-md border px-2 py-1" aria-label="開始日" />
        <span className="text-slate-400">〜</span>
        <input type="date" name="to" defaultValue={period.to ?? ""} className="rounded-md border px-2 py-1" aria-label="終了日" />
        <button type="submit" className={`${chip} ${period.preset === "custom" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          指定
        </button>
      </form>
    </div>
  );
}

export function AsOfPicker({ path, asOf }: { path: string; asOf: string }) {
  return (
    <form action={path} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm print:hidden">
      <span className="text-slate-500">基準日</span>
      <input type="date" name="asOf" defaultValue={asOf} className="rounded-md border px-2 py-1" aria-label="基準日" />
      <button type="submit" className={`${chip} border-slate-200 text-slate-600 hover:bg-slate-50`}>
        表示
      </button>
      <Link href={path} className="text-indigo-700 hover:underline">
        今日
      </Link>
    </form>
  );
}
