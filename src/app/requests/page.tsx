"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Kind = "LEAVE" | "PURCHASE" | "GENERAL";
type Row = {
  id: string;
  number: string;
  kind: Kind;
  title: string;
  amount: number | null;
  leaveDate: string | null;
  leaveHalfDays: number | null;
  requesterName: string;
  status: string;
  waitingFor: string | null;
  createdOn: string;
};
type Data = {
  requests: Row[];
  me: { id: string; role: string; staff: { id: string; name: string; balance: number } | null };
  todoCount: number;
};
type Route = { id: string; name: string; kind: string; minAmount: number; approvers: { id: string; name: string }[] };
type Routes = { routes: Route[]; users: { id: string; name: string; role: string }[] };

const KIND_LABELS: Record<string, string> = { LEAVE: "有給休暇", PURCHASE: "購入・支払", GENERAL: "その他", ALL: "すべて" };
const STATUS: Record<string, [string, string]> = {
  PENDING: ["承認待ち", "bg-amber-100 text-amber-800"],
  APPROVED: ["承認", "bg-emerald-100 text-emerald-800"],
  REJECTED: ["差戻し", "bg-rose-100 text-rose-700"],
  WITHDRAWN: ["取下げ", "bg-slate-100 text-slate-600"],
};
const inputClass = "w-full rounded-md border px-3 py-2 text-sm";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function RequestsPage() {
  const [view, setView] = useState<"todo" | "mine" | "all">("mine");
  const [data, setData] = useState<Data | null>(null);
  const [routes, setRoutes] = useState<Routes | null>(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<Kind>("PURCHASE");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvers, setApprovers] = useState<string[]>([""]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/requests?view=${view}`);
    if (res.ok) setData(await res.json());
  }, [view]);

  const loadRoutes = useCallback(async () => {
    const res = await fetch("/api/approval-routes");
    if (res.ok) setRoutes(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount/view change: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const isAdmin = data?.me.role === "ADMIN";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAdmin) loadRoutes();
  }, [isAdmin, loadRoutes]);

  async function post(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "保存できませんでした");
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const created = await post("/api/requests", "POST", {
      kind,
      title: f.get("title"),
      body: f.get("body"),
      amount: f.get("amount") ? Number(f.get("amount")) : undefined,
      payee: f.get("payee"),
      leaveDate: f.get("leaveDate"),
      leaveKind: f.get("leaveKind"),
    });
    if (created) {
      setCreating(false);
      setMessage(`${created.number}「${created.title}」を${created.status === "APPROVED" ? "申請し、承認されました" : "申請しました"}。`);
      setView("mine");
      await load();
    }
  }

  async function addRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const ok = await post("/api/approval-routes", "POST", {
      name: f.get("name"),
      kind: f.get("kind"),
      minAmount: f.get("minAmount") ? Number(f.get("minAmount")) : 0,
      approverIds: approvers.filter(Boolean),
    });
    if (ok) {
      form.reset();
      setApprovers([""]);
      setMessage("承認ルートを追加しました");
      await loadRoutes();
    }
  }

  const rows = data?.requests ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">申請・稟議</h1>
          <p className="mt-1 text-sm text-slate-600">
            有給休暇・購入や支払・その他の申請を出して、決められた順に承認してもらいます。承認する番になった人と、結果が出たときの申請者にはメールでお知らせします。
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700"
        >
          ＋ 新しい申請
        </button>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {creating && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">新しい申請</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["PURCHASE", "LEAVE", "GENERAL"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {KIND_LABELS[k]}
              </label>
            ))}
          </div>
          {kind === "LEAVE" ? (
            data?.me.staff ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-slate-600">休む日</span>
                  <input name="leaveDate" type="date" required defaultValue={todayKey()} className={`mt-1 ${inputClass}`} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">1日・半日</span>
                  <select name="leaveKind" className={`mt-1 ${inputClass}`}>
                    <option value="FULL">1日</option>
                    <option value="HALF">半日</option>
                  </select>
                </label>
                <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  {data.me.staff.name}さんの有給の残り
                  <div className="text-lg font-semibold">{data.me.staff.balance / 2}日</div>
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                あなたのアカウントはスタッフとひも付いていないため、有給を申請できません。管理者に「有給・残業」の画面でひも付けてもらってください。
              </p>
            )
          ) : (
            <>
              <label className="block text-sm">
                <span className="text-slate-600">件名</span>
                <input name="title" required maxLength={60} placeholder={kind === "PURCHASE" ? "例: ノートパソコンの購入" : "例: 展示会への出展"} className={`mt-1 ${inputClass}`} />
              </label>
              {kind === "PURCHASE" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-slate-600">金額(税込・円)</span>
                    <input name="amount" type="number" min={1} required className={`mt-1 ${inputClass}`} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-slate-600">購入先・支払先(任意)</span>
                    <input name="payee" maxLength={60} className={`mt-1 ${inputClass}`} />
                  </label>
                </div>
              )}
            </>
          )}
          <label className="block text-sm">
            <span className="text-slate-600">{kind === "LEAVE" ? "理由・連絡事項(任意)" : "内容・理由"}</span>
            <textarea name="body" rows={4} maxLength={2000} required={kind === "GENERAL"} className={`mt-1 ${inputClass}`} />
          </label>
          <div className="flex gap-2">
            <button disabled={busy || (kind === "LEAVE" && !data?.me.staff)} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              申請する
            </button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              やめる
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 border-b">
        {(
          [
            ["mine", "自分の申請"],
            ["todo", `承認待ち${data?.todoCount ? ` (${data.todoCount})` : ""}`],
            ...(data && data.me.role !== "EMPLOYEE" ? ([["all", "すべて"]] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-2 text-sm font-medium ${view === key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status]?.[1] ?? ""}`}>{STATUS[r.status]?.[0] ?? r.status}</span>
                    <span className="text-xs text-slate-500">
                      {r.number} ・ {KIND_LABELS[r.kind]}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-medium">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    {r.requesterName} ・ {r.createdOn.replaceAll("-", "/")}
                    {r.waitingFor && ` ・ ${r.waitingFor}さんの承認待ち`}
                  </div>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums">
                  {r.amount ? formatYen(r.amount) : r.leaveDate ? `${r.leaveDate.replaceAll("-", "/")}${r.leaveHalfDays === 1 ? " 半日" : ""}` : ""}
                </div>
              </Link>
            </li>
          ))}
          {data && rows.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">
              {view === "todo" ? "あなたが承認する申請はありません。" : view === "mine" ? "まだ申請はありません。" : "申請はありません。"}
            </li>
          )}
        </ul>
      </div>

      {isAdmin && routes && (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <summary className="cursor-pointer font-medium text-slate-700">承認ルートの設定(管理者)</summary>
          <p className="mt-2 text-xs text-slate-500">
            申請の種類(と購入・支払の金額)に合うルートの順に回します。合うルートがなければ、管理者のだれか1人が承認します。申請した本人の段は飛ばします。
          </p>
          <ul className="mt-3 divide-y rounded-lg border">
            {routes.routes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {KIND_LABELS[r.kind]}
                    {r.minAmount > 0 && ` ・ ${formatYen(r.minAmount)}以上`}
                  </span>
                  <span className="block text-xs text-slate-600">{r.approvers.map((a, i) => `${i + 1}. ${a.name}`).join(" → ")}</span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (await post(`/api/approval-routes/${r.id}`, "DELETE", undefined)) await loadRoutes();
                  }}
                  className="text-xs text-rose-600 hover:underline"
                >
                  削除
                </button>
              </li>
            ))}
            {routes.routes.length === 0 && <li className="px-3 py-2 text-slate-400">まだルートはありません(すべて管理者が承認します)</li>}
          </ul>
          <form onSubmit={addRoute} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs text-slate-500">名前</span>
                <input name="name" required maxLength={30} placeholder="例: 10万円以上の購入" className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">申請の種類</span>
                <select name="kind" className={`mt-1 ${inputClass}`}>
                  <option value="ALL">すべて</option>
                  <option value="PURCHASE">購入・支払</option>
                  <option value="LEAVE">有給休暇</option>
                  <option value="GENERAL">その他</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">金額がこれ以上のとき(購入・支払)</span>
                <input name="minAmount" type="number" min={0} placeholder="0" className={`mt-1 ${inputClass}`} />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {approvers.map((id, i) => (
                <label key={i} className="block">
                  <span className="text-xs text-slate-500">{i + 1}人目の承認者</span>
                  <select
                    value={id}
                    onChange={(e) => setApprovers((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    className={`mt-1 ${inputClass}`}
                  >
                    <option value="">選んでください</option>
                    {routes.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {approvers.length < 5 && (
                <button type="button" onClick={() => setApprovers((prev) => [...prev, ""])} className="rounded-md border border-dashed px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-50">
                  ＋ 承認者を足す
                </button>
              )}
            </div>
            <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              ルートを追加
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
