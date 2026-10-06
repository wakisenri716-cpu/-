"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Profile = Record<string, string | number | undefined>;
type Person = { id: string; name: string; active: boolean; hourlyWage: number; hireDate: string | null; profile: Profile };
type Data = { defaults: Record<string, string | undefined>; staff: Person[] };

const TYPES: Record<string, string> = { REGULAR: "正社員", CONTRACT: "契約社員", PART: "パート・アルバイト" };
const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

function Field({ label, name, value, type = "text", placeholder, wide = false }: { label: string; name: string; value?: string | number; type?: string; placeholder?: string; wide?: boolean }) {
  return (
    <label className={`block text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-slate-600">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={inputClass} />
    </label>
  );
}

export default function StaffRecordsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/staff-records");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function put(url: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "保存できませんでした");
      return false;
    }
    setMessage(done);
    await load();
    return true;
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (await put(`/api/staff-records/${editing.id}`, Object.fromEntries(new FormData(event.currentTarget)), `${editing.name}さんの情報を保存しました`)) setEditing(null);
  }

  async function saveDefaults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await put("/api/staff-records/defaults", Object.fromEntries(new FormData(event.currentTarget)), "会社の決まりを保存しました");
  }

  const p = editing?.profile ?? {};
  const d = data?.defaults ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">労働者名簿・賃金台帳</h1>
          <p className="mt-1 text-sm text-slate-600">
            法律で備えておく「法定三帳簿」のうち、労働者名簿と賃金台帳をここで作ります(出勤簿は「勤怠一覧」)。雇うときに渡す労働条件通知書も印刷できます。
          </p>
        </div>
        <Link href="/staff-records/roster" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          労働者名簿を印刷
        </Link>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">スタッフ</h2>
            <label className="text-sm">
              賃金台帳の年{" "}
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border px-2 py-1">
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="divide-y text-sm">
            {data.staff.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${s.active ? "" : "text-slate-400"}`}>
                <div className="min-w-0">
                  <div className="font-medium">
                    {s.name}
                    {s.profile.kana && <span className="ml-2 text-xs text-slate-500">{s.profile.kana}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {TYPES[String(s.profile.employmentType)] ?? "雇用形態 未入力"} ・ 入社 {s.hireDate?.replaceAll("-", "/") ?? "未入力"}
                    {s.profile.retireDate && ` ・ 退職 ${String(s.profile.retireDate).replaceAll("-", "/")}`}
                    {!s.profile.birthDate && <span className="ml-2 text-amber-700">生年月日・住所が未入力</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <button onClick={() => setEditing(s)} className="text-indigo-700 hover:underline">
                    情報を編集
                  </button>
                  <Link href={`/staff-records/${s.id}/notice`} className="text-indigo-700 hover:underline">
                    労働条件通知書
                  </Link>
                  <Link href={`/staff-records/${s.id}/wages?year=${year}`} className="text-indigo-700 hover:underline">
                    賃金台帳({year}年)
                  </Link>
                </div>
              </li>
            ))}
            {data.staff.length === 0 && <li className="px-4 py-6 text-center text-slate-400">「シフト管理」でスタッフを登録してください</li>}
          </ul>
        </section>
      )}

      {data && (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <summary className="cursor-pointer font-medium text-slate-700">労働条件通知書に入れる会社の決まり</summary>
          <form key={JSON.stringify(d)} onSubmit={saveDefaults} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="就業の場所" name="workplace" value={d.workplace} placeholder="例: 本社(東京都千代田区…)" />
            <Field label="休日" name="holidays" value={d.holidays} placeholder="例: 土日・祝日、年末年始" />
            <Field label="賃金の締切日" name="closingDay" value={d.closingDay} placeholder="例: 毎月末日" />
            <Field label="賃金の支払日" name="payDay" value={d.payDay} placeholder="例: 翌月25日" />
            <Field label="賃金の支払方法" name="payMethod" value={d.payMethod} placeholder="例: 本人名義の口座に振込" />
            <Field label="相談窓口" name="consultation" value={d.consultation} placeholder="例: 総務担当 山田(03-1234-5678)" />
            <Field label="退職に関する事項" name="retirement" value={d.retirement} placeholder="例: 自己都合退職は30日前までに届け出ること" wide />
            <div className="sm:col-span-2">
              <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                保存
              </button>
            </div>
          </form>
        </details>
      )}

      {editing && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <form onSubmit={saveProfile} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">{editing.name}さんの情報</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ふりがな" name="kana" value={p.kana} />
              <Field label="生年月日" name="birthDate" type="date" value={p.birthDate} />
              <Field label="性別(任意)" name="gender" value={p.gender} />
              <Field label="電話番号" name="phone" value={p.phone} />
              <Field label="住所" name="address" value={p.address} wide />
              <label className="block text-sm">
                <span className="text-slate-600">雇用形態</span>
                <select name="employmentType" defaultValue={String(p.employmentType ?? "")} className={inputClass}>
                  <option value="">選んでください</option>
                  {Object.entries(TYPES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="入社日(雇入れ日)" name="hireDate" type="date" value={editing.hireDate ?? ""} />
              <Field label="仕事の内容" name="job" value={p.job} placeholder="例: 店舗での接客・販売" />
              <Field label="就業の場所(会社の決まりと違うとき)" name="workplace" value={p.workplace} />
              <Field label="契約の終わりの日(期間の定めがあるとき)" name="contractEnd" type="date" value={p.contractEnd} />
              <Field label="契約の更新" name="renewal" value={p.renewal} placeholder="例: 更新する場合があり得る(勤務成績による)" />
              <Field label="始業" name="workStart" type="time" value={p.workStart} />
              <Field label="終業" name="workEnd" type="time" value={p.workEnd} />
              <Field label="休憩(分)" name="breakMinutes" type="number" value={p.breakMinutes} />
              <Field label="勤務する日" name="workDays" value={p.workDays} placeholder="例: 週3日(シフトによる)" />
              <Field label="休日(会社の決まりと違うとき)" name="holidays" value={p.holidays} wide />
              <Field label="退職日" name="retireDate" type="date" value={p.retireDate} />
              <Field label="退職の事由" name="retireReason" value={p.retireReason} placeholder="例: 自己都合" />
            </div>
            <p className="text-xs text-slate-500">マイナンバーはこのシステムでは預かりません。時給・社会保険は「シフト管理」「給与計算」の設定を使います。</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                やめる
              </button>
              <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
