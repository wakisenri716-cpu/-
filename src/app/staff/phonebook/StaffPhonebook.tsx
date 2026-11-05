"use client";

import { useEffect, useState } from "react";

type Entry = { id: string; name: string; extension: string | null; direct: string | null; mobile: string | null; note: string | null; me: boolean };
type Data = { count: number; groups: { department: string | null; entries: Entry[] }[] };
const tel = (n: string) => `tel:${n.replace(/[^\d]/g, "")}`;

export function StaffPhonebook() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const load = (query = "") =>
    fetch(`/api/staff-app/phonebook${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((r) => (r.ok ? r.json() : { count: 0, groups: [] }))
      .then(setData)
      .catch(() => setData({ count: 0, groups: [] }));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">社内の電話帳</h1>
        <p className="mt-1 text-sm text-slate-600">内線・直通・社用携帯の番号です。番号を押すと電話をかけられます。</p>
      </div>
      <input value={q} onChange={(e) => (setQ(e.target.value), load(e.target.value.trim()))} placeholder="名前・部署・番号で探す" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
      {!data ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : !data.groups.length ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{q ? "見つかりませんでした。" : "電話帳はまだ作られていません。総務に聞いてください。"}</p>
      ) : (
        data.groups.map((g) => (
          <section key={g.department ?? "-"} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-semibold text-slate-500">{g.department ?? "部署なし・場所"}</h2>
            <ul className="mt-1 divide-y divide-slate-100">
              {g.entries.map((e) => (
                <li key={e.id} className="py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.name}</span>
                    {e.me && <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">自分</span>}
                    {e.extension && <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">内線 {e.extension}</span>}
                  </div>
                  {(e.direct || e.mobile || e.note) && (
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                      {e.direct && (
                        <a href={tel(e.direct)} className="text-indigo-700 underline">
                          直通 {e.direct}
                        </a>
                      )}
                      {e.mobile && (
                        <a href={tel(e.mobile)} className="text-indigo-700 underline">
                          携帯 {e.mobile}
                        </a>
                      )}
                      {e.note && <span className="text-slate-500">{e.note}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
