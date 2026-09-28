"use client";

import { useEffect, useState } from "react";

type Loan = { id: string; name: string; code: string | null; lentAt: string; dueDate: string | null };

// 今年の日付は「月/日」、ほかの年は「年/月/日」
const md = (d: string | null) =>
  d ? `${d.slice(0, 4) === String(new Date().getFullYear()) ? "" : `${d.slice(0, 4)}/`}${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";

// 会社から借りている備品(パソコン・鍵など)。借りているものがあるときだけ出す
export function LoansSection() {
  const [loans, setLoans] = useState<Loan[]>([]);

  useEffect(() => {
    fetch("/api/equipment/mine")
      .then((res) => (res.ok ? res.json() : []))
      .then(setLoans)
      .catch(() => {});
  }, []);

  if (!loans.length) return null;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">借りている備品</h2>
      <p className="text-sm text-slate-600">会社から借りているものです。返すときは管理者に渡してください。</p>
      <ul className="divide-y divide-slate-100 text-sm">
        {loans.map((l) => {
          const overdue = !!l.dueDate && l.dueDate < today;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {l.code && <span className="mr-1 text-xs text-slate-400">{l.code}</span>}
                {l.name}
              </span>
              <span className={`text-xs ${overdue ? "font-medium text-rose-600" : "text-slate-500"}`}>
                {md(l.lentAt)}から{l.dueDate ? ` / ${md(l.dueDate)}までに返却${overdue ? "(過ぎています)" : ""}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
