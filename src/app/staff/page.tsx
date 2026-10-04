"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BoxIcon, CalendarIcon, ClockIcon, MegaphoneIcon, NotebookIcon, ReceiptIcon, StampIcon } from "@/components/icons";

type Shift = { date: string; weekday: string; start: string; end: string; breakMinutes: number; today: boolean };
type Home = {
  name: string;
  staff: { id: string; name: string } | null;
  shifts: Shift[];
  unreadManuals: number;
  unreadNotices: number;
  latestNotices: { id: string; title: string }[];
  lowStock: number;
  hasProducts: boolean;
};

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export default function StaffHome() {
  const [data, setData] = useState<Home | null>(null);

  useEffect(() => {
    fetch("/api/staff-app/home")
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <p className="py-10 text-center text-sm text-slate-400">読み込み中...</p>;
  const today = data.shifts.find((s) => s.today);
  const upcoming = data.shifts.filter((s) => !s.today);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(new Date())}</p>
        <h1 className="text-xl font-semibold">{data.name}さん、おつかれさまです</h1>
      </div>

      <section className="rounded-2xl bg-indigo-600 p-4 text-white shadow-sm">
        <p className="text-xs text-indigo-100">今日のシフト</p>
        {!data.staff ? (
          <p className="mt-1 text-sm">シフトを見るには、管理者に「シフト管理」でのスタッフ登録とアカウントのひも付けを頼んでください。</p>
        ) : today ? (
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {today.start}〜{today.end}
            {today.breakMinutes > 0 && <span className="ml-2 text-sm font-normal text-indigo-100">休憩{today.breakMinutes}分</span>}
          </p>
        ) : (
          <p className="mt-1 text-lg font-medium">今日はお休みです</p>
        )}
        {data.staff && (
          <Link href="/timeclock" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25">
            <ClockIcon className="h-4 w-4" />
            タイムカードを押す
          </Link>
        )}
      </section>

      {data.staff && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">これからのシフト</h2>
            <Link href="/staff/shifts?tab=confirmed" className="text-sm text-indigo-700">
              すべて見る
            </Link>
          </div>
          {upcoming.length ? (
            <ul className="mt-2 divide-y divide-slate-100">
              {upcoming.map((s) => (
                <li key={`${s.date}${s.start}`} className="flex justify-between py-2 text-sm">
                  <span>
                    {md(s.date)}({s.weekday})
                  </span>
                  <span className="tabular-nums">
                    {s.start}〜{s.end}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">まだ決まったシフトはありません。</p>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Tile href="/staff/shifts" icon={CalendarIcon} label="シフト希望を出す" note="来月の出られる日・休みたい日" />
        <Tile href="/staff/manuals" icon={NotebookIcon} label="マニュアル" note={data.unreadManuals ? `未読 ${data.unreadManuals}件` : "すべて読みました"} alert={data.unreadManuals > 0} />
        <Tile href="/notices" icon={MegaphoneIcon} label="お知らせ" note={data.unreadNotices ? `未読 ${data.unreadNotices}件` : "新しいお知らせはありません"} alert={data.unreadNotices > 0} />
        {data.hasProducts && <Tile href="/staff/stock?filter=low" icon={BoxIcon} label="在庫" note={data.lowStock ? `少ない商品 ${data.lowStock}件` : "在庫は足りています"} alert={data.lowStock > 0} />}
      </div>

      {data.latestNotices.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">新しいお知らせ</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {data.latestNotices.map((n) => (
              <li key={n.id}>
                <Link href="/notices" className="text-amber-900 underline-offset-2 hover:underline">
                  {n.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[
          { href: "/timeclock", label: "タイムカード", icon: ClockIcon },
          { href: "/expenses", label: "経費精算", icon: ReceiptIcon },
          { href: "/requests", label: "申請", icon: StampIcon },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white py-3 text-slate-700 shadow-sm">
            <l.icon className="h-5 w-5 text-indigo-600" />
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Tile({ href, icon: Icon, label, note, alert }: { href: string; icon: typeof CalendarIcon; label: string; note: string; alert?: boolean }) {
  return (
    <Link href={href} className={`rounded-2xl border bg-white p-4 shadow-sm ${alert ? "border-rose-200" : "border-slate-200"}`}>
      <Icon className="h-6 w-6 text-indigo-600" />
      <p className="mt-2 font-medium">{label}</p>
      <p className={`text-xs ${alert ? "font-medium text-rose-600" : "text-slate-500"}`}>{note}</p>
    </Link>
  );
}
