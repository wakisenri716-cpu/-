"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";

type Stage = "LEAD" | "PROPOSAL" | "QUOTED" | "WON" | "LOST";
type Deal = {
  id: string;
  title: string;
  customerName: string;
  amount: number;
  stage: Stage;
  probability: number;
  probabilitySet: boolean;
  expectedClose: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  overdue: boolean;
  ownerName: string | null;
  notes: string | null;
  lostReason: string | null;
  closedAt: string | null;
  project: { id: string; name: string } | null;
};
type Data = {
  stages: { key: Stage; label: string; probability: number; open: boolean }[];
  deals: Deal[];
  summary: {
    openCount: number;
    openAmount: number;
    weighted: number;
    wonThisMonth: number;
    winRate: number | null;
    overdue: number;
  };
};

const TONE: Record<Stage, string> = {
  LEAD: "border-slate-300",
  PROPOSAL: "border-sky-300",
  QUOTED: "border-indigo-300",
  WON: "border-emerald-300",
  LOST: "border-slate-200",
};
const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const md = (d: string | null) =>
  d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : "";

function DealForm({
  deal,
  stages,
  busy,
  onSubmit,
  onCancel,
}: {
  deal?: Deal;
  stages: Data["stages"];
  busy: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-600">商談名</span>
          <input
            name="title"
            required
            maxLength={80}
            defaultValue={deal?.title}
            placeholder="例: Webサイトのリニューアル"
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">顧客</span>
          <input
            name="customerName"
            required
            maxLength={100}
            defaultValue={deal?.customerName}
            placeholder="例: 株式会社ひかり商事"
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">見込みの金額(円・税抜)</span>
          <input
            name="amount"
            inputMode="numeric"
            defaultValue={deal?.amount || ""}
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-slate-600">段階</span>
            <select
              name="stage"
              defaultValue={deal?.stage ?? "LEAD"}
              className={inputClass}
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">確度(%)</span>
            <input
              name="probability"
              inputMode="numeric"
              defaultValue={deal?.probabilitySet ? deal.probability : ""}
              placeholder="段階の目安"
              className={inputClass}
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">受注の見込み日</span>
          <input
            name="expectedClose"
            type="date"
            defaultValue={deal?.expectedClose ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">担当者</span>
          <input
            name="ownerName"
            maxLength={40}
            defaultValue={deal?.ownerName ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">次にやること</span>
          <input
            name="nextAction"
            maxLength={100}
            defaultValue={deal?.nextAction ?? ""}
            placeholder="例: 見積書を送る、電話で返事を聞く"
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">次にやる日</span>
          <input
            name="nextActionDate"
            type="date"
            defaultValue={deal?.nextActionDate ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">メモ</span>
          <textarea
            name="notes"
            rows={2}
            maxLength={1000}
            defaultValue={deal?.notes ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">失注の理由(失注したとき)</span>
          <input
            name="lostReason"
            maxLength={200}
            defaultValue={deal?.lostReason ?? ""}
            placeholder="例: 価格が合わなかった"
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          disabled={busy}
          className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          やめる
        </button>
      </div>
    </form>
  );
}

export default function DealsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Deal | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/deals");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(
    url: string,
    method: string,
    body?: object,
    done?: string,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return null;
    }
    if (done) setMessage(done);
    await load();
    return json;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const ok =
      editing === "new"
        ? await call("/api/deals", "POST", body, "商談を登録しました")
        : editing &&
          (await call(
            `/api/deals/${editing.id}`,
            "PATCH",
            body,
            "商談を保存しました",
          ));
    if (ok) setEditing(null);
  }

  async function move(deal: Deal, stage: Stage) {
    await call(`/api/deals/${deal.id}`, "PATCH", { stage });
  }

  async function makeProject(deal: Deal) {
    const p = await call(`/api/deals/${deal.id}/project`, "POST", undefined);
    if (p)
      setMessage(
        `案件「${p.name}」を作りました。「案件別損益」で売上・原価を集計できます`,
      );
  }

  async function remove(deal: Deal) {
    if (!confirm(`「${deal.title}」を削除しますか?`)) return;
    if (
      await call(
        `/api/deals/${deal.id}`,
        "DELETE",
        undefined,
        "商談を削除しました",
      )
    )
      setEditing(null);
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">商談管理</h1>
          <p className="mt-1 text-sm text-slate-600">
            受注までの見込みを段階ごとに並べます。金額に確度をかけた「見込みの売上」と、次にやることを確かめられます。受注したら見積書・案件につなげられます。
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700"
        >
          + 商談を登録
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: `進行中の商談(${s.openCount}件)`,
              value: formatYen(s.openAmount),
            },
            { label: "見込みの売上(金額×確度)", value: formatYen(s.weighted) },
            { label: "今月の受注", value: formatYen(s.wonThisMonth) },
            {
              label: "受注率(直近90日)",
              value: s.winRate === null ? "-" : `${s.winRate}%`,
            },
          ].map((t) => (
            <div
              key={t.label}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs text-slate-500">{t.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {t.value}
              </p>
            </div>
          ))}
        </div>
      )}
      {s && s.overdue > 0 && (
        <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
          次にやる日が今日までの商談が{s.overdue}件あります(赤い日付)。
        </div>
      )}

      {data && (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-5">
          {data.stages.map((stage) => {
            const list = data.deals.filter((d) => d.stage === stage.key);
            const i = data.stages.findIndex((x) => x.key === stage.key);
            return (
              <section
                key={stage.key}
                className="min-w-0 space-y-2 rounded-xl bg-slate-100 p-2"
              >
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold">
                    {stage.label}{" "}
                    <span className="font-normal text-slate-500">
                      {list.length}
                    </span>
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {formatYen(list.reduce((sum, d) => sum + d.amount, 0))}
                  </span>
                </div>
                {!stage.open && (
                  <p className="px-1 text-[11px] text-slate-400">直近90日</p>
                )}
                {list.map((d) => (
                  <article
                    key={d.id}
                    className={`space-y-1 rounded-lg border-l-4 bg-white p-2.5 text-sm shadow-sm ${TONE[d.stage]} ${d.stage === "LOST" ? "opacity-60" : ""}`}
                  >
                    <button
                      onClick={() => setEditing(d)}
                      className="block w-full text-left"
                    >
                      <span className="block font-medium hover:underline">
                        {d.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {d.customerName}
                      </span>
                      <span className="mt-1 flex items-baseline justify-between">
                        <span className="font-semibold tabular-nums">
                          {formatYen(d.amount)}
                        </span>
                        {stage.open && (
                          <span className="text-[11px] text-slate-500">
                            確度 {d.probability}%
                          </span>
                        )}
                      </span>
                      {d.nextAction && (
                        <span
                          className={`mt-1 block text-xs ${d.overdue ? "font-medium text-rose-700" : "text-slate-600"}`}
                        >
                          {d.nextActionDate && `${md(d.nextActionDate)} `}
                          {d.nextAction}
                        </span>
                      )}
                      {d.expectedClose && stage.open && (
                        <span className="block text-[11px] text-slate-400">
                          受注見込み {md(d.expectedClose)}
                        </span>
                      )}
                      {d.lostReason && d.stage === "LOST" && (
                        <span className="block text-[11px] text-slate-500">
                          理由: {d.lostReason}
                        </span>
                      )}
                    </button>
                    {d.stage !== "LOST" && (
                      <div className="flex flex-wrap gap-x-2 gap-y-1 border-t pt-1 text-[11px]">
                        {stage.open && i > 0 && (
                          <button
                            onClick={() => move(d, data.stages[i - 1].key)}
                            disabled={busy}
                            className="text-slate-500 hover:underline"
                          >
                            ← 戻す
                          </button>
                        )}
                        {stage.open && (
                          <button
                            onClick={() => move(d, data.stages[i + 1].key)}
                            disabled={busy}
                            className="text-indigo-700 hover:underline"
                          >
                            {data.stages[i + 1].label}へ →
                          </button>
                        )}
                        {stage.open && (
                          <button
                            onClick={() => move(d, "LOST")}
                            disabled={busy}
                            className="text-slate-400 hover:text-rose-700 hover:underline"
                          >
                            失注
                          </button>
                        )}
                        {d.stage === "PROPOSAL" && (
                          <Link
                            href={`/quotes/new?customer=${encodeURIComponent(d.customerName)}`}
                            className="text-indigo-700 hover:underline"
                          >
                            見積書を作る
                          </Link>
                        )}
                        {d.stage === "WON" &&
                          (d.project ? (
                            <Link
                              href={`/projects/${d.project.id}`}
                              className="text-emerald-700 hover:underline"
                            >
                              案件を見る
                            </Link>
                          ) : (
                            <button
                              onClick={() => makeProject(d)}
                              disabled={busy}
                              className="text-emerald-700 hover:underline"
                            >
                              案件にする
                            </button>
                          ))}
                      </div>
                    )}
                  </article>
                ))}
                {list.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-slate-400">
                    なし
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editing && data && (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center"
          onClick={() => setEditing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {editing === "new" ? "商談を登録" : "商談を編集"}
              </h2>
              {editing !== "new" && (
                <button
                  onClick={() => remove(editing)}
                  disabled={busy}
                  className="text-xs text-slate-500 hover:text-rose-700 hover:underline"
                >
                  削除
                </button>
              )}
            </div>
            <DealForm
              deal={editing === "new" ? undefined : editing}
              stages={data.stages}
              busy={busy}
              onSubmit={save}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
