"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// 別の会社(屋号・グループ会社など)を追加する。追加すると、左上の切り替えでその会社を開ける
export function AddCompany({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.get("name"), fiscalYearStartMonth: Number(f.get("month")) }),
    });
    if (res.ok) {
      setOpen(false);
      setBusy(false);
      router.refresh();
      return;
    }
    setBusy(false);
    setError((await res.json().catch(() => ({}))).error ?? "追加できませんでした");
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">複数の会社</h2>
          <p className="text-sm text-slate-600">
            別の会社や屋号の帳簿を、同じログインで切り替えて使えます。帳簿・請求書・従業員などのデータは会社ごとに分かれます。
          </p>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            ＋ 会社を追加
          </button>
        )}
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {companies.map((c) => (
          <li key={c.id} className="rounded-full bg-slate-100 px-3 py-1">
            {c.name}
          </li>
        ))}
      </ul>
      {open && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 text-sm">
            <span className="text-slate-600">会社名・屋号</span>
            <input name="name" required maxLength={60} className="mt-1 w-full rounded-md border px-3 py-2" placeholder="例: 株式会社サンプル" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">決算期の始まり</span>
            <select name="month" defaultValue={4} className="mt-1 block rounded-md border px-3 py-2">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}月
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            追加して開く
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            やめる
          </button>
        </form>
      )}
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <p className="text-xs text-slate-500">
        追加した会社では、あなたが管理者になります。ほかの人を入れるときは、その会社を開いて「ユーザー管理」から追加してください(ほかの会社のアカウントを持っている人は、メールアドレスだけで追加できます)。
      </p>
    </section>
  );
}
