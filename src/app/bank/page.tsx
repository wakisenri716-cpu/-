"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

type Account = { id: string; code: string; name: string; category: string };

type BankRow = {
  id: string;
  date: string;
  description: string;
  withdrawal: number;
  deposit: number;
  status: "PENDING" | "POSTED" | "MATCHED" | "IGNORED";
  suggestedAccountCode: string | null;
  confidence: number | null;
  suggestionSource: string | null;
  suggestionReason: string | null;
  matchedInvoice?: { invoiceNumber: string | null } | null;
};

type BankAccountInfo = {
  id: string;
  name: string;
  kind: "BANK" | "CARD";
  active: boolean;
  debitKeyword: string | null;
  accountCode: string;
  accountName: string;
  balance: number;
  pending: number;
  lastDate: string | null;
};

type BankData = { bankAccount: { id: string; name: string; kind: "BANK" | "CARD"; active: boolean }; pending: BankRow[]; processed: BankRow[]; accounts: Account[] };

type ImportSummary = { received: number; imported: number; matched: number; autoPosted: number; pending: number };

const SOURCE_LABELS: Record<string, string> = {
  INVOICE: "請求書消込",
  HISTORY: "過去の記帳から学習",
  RULE: "キーワード",
  AI: "AI",
  MANUAL: "手動で確定",
};

const CATEGORY_LABELS: [string, string][] = [
  ["ASSET", "資産"],
  ["LIABILITY", "負債"],
  ["EQUITY", "純資産"],
  ["REVENUE", "収益"],
  ["EXPENSE", "費用"],
];

function confidenceClass(confidence: number | null) {
  if (confidence == null) return "bg-slate-100 text-slate-600";
  if (confidence >= 0.9) return "bg-emerald-100 text-emerald-800";
  if (confidence >= 0.6) return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-700";
}

export default function BankPage() {
  const [data, setData] = useState<BankData | null>(null);
  const [banks, setBanks] = useState<BankAccountInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [tab, setTab] = useState<"pending" | "processed">("pending");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(accountId = selected) {
    const [res, list] = await Promise.all([
      fetch(`/api/bank${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`),
      fetch("/api/bank-accounts"),
    ]);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "読み込めませんでした");
      return;
    }
    setData(body);
    setSelected(body.bankAccount.id);
    if (list.ok) setBanks(await list.json());
  }

  useEffect(() => {
    // Fetch-on-mount: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(id: string) {
    setSelected(id);
    setTab("pending");
    setMessage(null);
    setError(null);
    setChoices({});
    load(id);
  }

  async function addBank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), kind: form.get("kind"), debitKeyword: form.get("debitKeyword") }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "登録できませんでした");
      return;
    }
    setAdding(false);
    setMessage(`「${body.name}」を登録しました。この${body.kind === "CARD" ? "カード" : "口座"}の明細CSVを取り込めます。`);
    choose(body.id);
  }

  async function updateBank(patch: Record<string, unknown>, done: string) {
    if (!current) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/bank-accounts/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "変更できませんでした");
      return;
    }
    setMessage(done);
    await load();
  }

  const accounts = data?.accounts ?? [];
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData(form);
      if (selected) formData.set("bankAccountId", selected);
      const res = await fetch("/api/bank/import", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "取込に失敗しました");
      const s = body as ImportSummary;
      const parts = [`${s.imported}件を取込`];
      if (s.received > s.imported) parts.push(`${s.received - s.imported}件は取込済みのためスキップ`);
      parts.push(`請求書と消込 ${s.matched}件`, `自動で仕訳 ${s.autoPosted}件`, `確認待ち ${s.pending}件`);
      setMessage(parts.join(" / "));
      setTab(s.pending > 0 ? "pending" : "processed");
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setUploading(false);
    }
  }

  async function act(row: BankRow, action: "confirm" | "ignore" | "reopen") {
    const accountId = choices[row.id] ?? accountByCode.get(row.suggestedAccountCode ?? "")?.id ?? "";
    if (action === "confirm" && !accountId) {
      setError("勘定科目を選択してください");
      return;
    }
    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/bank/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "処理に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusyId(null);
    }
  }

  function resultLabel(row: BankRow) {
    if (row.status === "MATCHED") return `請求書 ${row.matchedInvoice?.invoiceNumber ?? ""} を消込`;
    if (row.status === "IGNORED") return "対象外";
    const account = accountByCode.get(row.suggestedAccountCode ?? "");
    return account ? `${account.code} ${account.name}` : "-";
  }

  const pending = data?.pending ?? [];
  const processed = data?.processed ?? [];
  const current = banks.find((b) => b.id === selected) ?? null;
  const isCard = (current?.kind ?? data?.bankAccount.kind) === "CARD";
  const visibleBanks = banks.filter((b) => b.active || showInactive || b.id === selected);
  const inactiveCount = banks.filter((b) => !b.active).length;
  const cashTotal = banks.filter((b) => b.kind === "BANK").reduce((s, b) => s + b.balance, 0);
  const cardTotal = banks.filter((b) => b.kind === "CARD").reduce((s, b) => s + b.balance, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">銀行・カード明細</h1>
          <PrintButton variant="outline" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          ネットバンキングやカード会社のサイトからダウンロードした明細のCSVを取り込むと、請求書と金額が一致するものは自動で消込み、
          それ以外は過去の記帳・キーワード・AIで勘定科目を判定して仕訳します。自信が低いものだけ「確認待ち」に残ります。
          銀行口座・クレジットカードは複数登録でき、それぞれ専用の科目(「普通預金(〇〇銀行)」「未払金(〇〇カード)」)で記帳します。
        </p>
      </div>

      <section className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">口座・カード</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span>
              預金の合計 <span className="font-semibold text-slate-900">{formatYen(cashTotal)}</span>
            </span>
            {banks.some((b) => b.kind === "CARD") && (
              <span>
                カードの未払い <span className="font-semibold text-slate-900">{formatYen(cardTotal)}</span>
              </span>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleBanks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => choose(b.id)}
              aria-pressed={b.id === selected}
              className={`rounded-xl border p-3 text-left shadow-sm transition ${
                b.id === selected ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "border-slate-200 bg-white hover:border-indigo-300"
              } ${b.active ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{b.name}</div>
                  <div className="text-xs text-slate-500">
                    {b.kind === "CARD" ? "クレジットカード" : "銀行口座"} ・ {b.accountCode} {b.accountName}
                    {!b.active && " ・ しまってあります"}
                  </div>
                </div>
                {b.pending > 0 && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800">確認待ち {b.pending}</span>
                )}
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-xs text-slate-500">{b.kind === "CARD" ? "未払い(利用の残り)" : "帳簿の残高"}</span>
                <span className="text-lg font-semibold tabular-nums">{formatYen(b.balance)}</span>
              </div>
              <div className="text-right text-xs text-slate-400">{b.lastDate ? `最新の明細 ${formatDate(b.lastDate)}` : "明細はまだありません"}</div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex min-h-[7rem] items-center justify-center rounded-xl border border-dashed border-slate-300 p-3 text-sm font-medium text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50"
          >
            ＋ 口座・カードを追加
          </button>
        </div>
        {inactiveCount > 0 && (
          <button type="button" onClick={() => setShowInactive((v) => !v)} className="text-xs text-slate-500 hover:text-indigo-700 hover:underline">
            {showInactive ? "しまった口座・カードを隠す" : `しまった口座・カードも表示(${inactiveCount})`}
          </button>
        )}

        {adding && (
          <form onSubmit={addBank} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold">口座・カードを追加</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" name="kind" value="BANK" defaultChecked /> 銀行口座
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="kind" value="CARD" /> クレジットカード
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600">名前</span>
              <input name="name" required maxLength={30} placeholder="例: みずほ銀行、楽天カード" className="mt-1 w-full rounded-md border px-3 py-2 sm:max-w-sm" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">カードの引落しの目印(カードのとき・任意)</span>
              <input name="debitKeyword" maxLength={30} placeholder="例: ﾐﾂｲｽﾐﾄﾓｶｰﾄﾞ" className="mt-1 w-full rounded-md border px-3 py-2 sm:max-w-sm" />
              <span className="mt-1 block text-xs text-slate-500">
                銀行の明細の摘要にこの文字があると、カード代金の引落しとして「未払金(このカード)」で記帳します(半角・全角どちらでも可)。
              </span>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                登録する
              </button>
              <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </form>
        )}

        {current && (
          <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <summary className="cursor-pointer font-medium text-slate-700">「{current.name}」の設定</summary>
            <div className="mt-3 space-y-3">
              <form
                key={`name-${current.id}-${current.name}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  updateBank({ name: new FormData(e.currentTarget).get("name") }, "名前を変えました");
                }}
                className="flex flex-wrap items-end gap-2"
              >
                <label className="block">
                  <span className="text-slate-600">名前</span>
                  <input name="name" defaultValue={current.name} maxLength={30} className="mt-1 block w-full rounded-md border px-3 py-1.5 sm:w-64" />
                </label>
                <button className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">変更</button>
              </form>
              {current.kind === "CARD" && (
                <form
                  key={`kw-${current.id}-${current.debitKeyword ?? ""}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateBank({ debitKeyword: new FormData(e.currentTarget).get("debitKeyword") }, "引落しの目印を変えました");
                  }}
                  className="flex flex-wrap items-end gap-2"
                >
                  <label className="block">
                    <span className="text-slate-600">引落しの目印</span>
                    <input name="debitKeyword" defaultValue={current.debitKeyword ?? ""} maxLength={30} placeholder="例: ﾐﾂｲｽﾐﾄﾓｶｰﾄﾞ" className="mt-1 block w-full rounded-md border px-3 py-1.5 sm:w-64" />
                  </label>
                  <button className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">変更</button>
                </form>
              )}
              <p className="text-xs text-slate-500">
                記帳する科目: {current.accountCode} {current.accountName}(科目名は「勘定科目」の画面で変えられます)
              </p>
              <button
                type="button"
                onClick={() => updateBank({ active: !current.active }, current.active ? "しまいました(明細と仕訳は残ります)" : "使えるように戻しました")}
                className="text-xs text-slate-500 hover:text-rose-700 hover:underline"
              >
                {current.active ? "使わなくなったのでしまう" : "使えるように戻す"}
              </button>
            </div>
          </details>
        )}
      </section>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <h2 className="font-semibold">{current ? `「${current.name}」の` : ""}明細CSVを取り込む</h2>
        <p className="text-xs text-slate-500">
          {isCard
            ? "カード会社の利用明細のCSV(「利用日」「利用店名」「利用金額」の列。見出しのない形式も可)に対応しています。マイナスの金額は返品・取消として扱います。"
            : "「日付」「摘要(内容)」「出金(お引出し)」「入金(お預入れ)」「残高」の列があるCSVに対応しています。"}
          (Shift_JIS/UTF-8どちらも可)同じ明細を何度取り込んでも二重にはなりません。
          {/* ページ遷移ではなくCSVファイルのダウンロードなので <Link> ではなく <a> を使う */}
          <a href={isCard ? "/api/bank/sample?kind=card" : "/api/bank/sample"} className="ml-1 text-indigo-700 hover:underline">
            サンプルCSV
          </a>
        </p>
        {current && !current.active && <p className="text-xs text-rose-700">この{isCard ? "カード" : "口座"}はしまってあるため取り込めません。</p>}
        <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="max-w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={uploading || (current ? !current.active : false)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploading ? "AIが判定中..." : "取り込んで自動仕訳"}
          </button>
        </form>
      </section>

      <div className="flex gap-2 border-b">
        {(
          [
            ["pending", `確認待ち (${pending.length})`],
            ["processed", "処理済み"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">日付</th>
                <th className="px-4 py-2">{isCard ? "利用先" : "摘要"}</th>
                <th className="px-4 py-2 text-right">{isCard ? "利用" : "出金"}</th>
                <th className="px-4 py-2 text-right">{isCard ? "返品・取消" : "入金"}</th>
                <th className="px-4 py-2">{tab === "pending" ? "AIの提案" : "結果"}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(tab === "pending" ? pending : processed).map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="min-w-[10rem] px-4 py-2">{row.description}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{row.withdrawal ? formatYen(row.withdrawal) : ""}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{row.deposit ? formatYen(row.deposit) : ""}</td>
                  <td className="min-w-[14rem] px-4 py-2">
                    {tab === "pending" ? (
                      <select
                        value={choices[row.id] ?? accountByCode.get(row.suggestedAccountCode ?? "")?.id ?? ""}
                        onChange={(e) => setChoices((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        className="w-full rounded-md border px-2 py-1 text-sm"
                      >
                        <option value="">選択してください</option>
                        {CATEGORY_LABELS.map(([category, label]) => (
                          <optgroup key={category} label={label}>
                            {accounts
                              .filter((a) => a.category === category)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.code} {a.name}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    ) : (
                      <div className={row.status === "IGNORED" ? "text-slate-400" : ""}>{resultLabel(row)}</div>
                    )}
                    {row.suggestionSource && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className={`rounded-full px-2 py-0.5 font-medium whitespace-nowrap ${confidenceClass(row.confidence)}`}>
                          {SOURCE_LABELS[row.suggestionSource] ?? row.suggestionSource}
                          {row.confidence != null && ` ${Math.round(row.confidence * 100)}%`}
                        </span>
                        <span>{row.suggestionReason}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {tab === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => act(row, "confirm")}
                          disabled={busyId === row.id}
                          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          確定
                        </button>
                        <button
                          onClick={() => act(row, "ignore")}
                          disabled={busyId === row.id}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          対象外
                        </button>
                      </div>
                    ) : (
                      row.status !== "MATCHED" && (
                        <button
                          onClick={() => act(row, "reopen")}
                          disabled={busyId === row.id}
                          className="text-xs text-slate-500 hover:text-indigo-700 hover:underline disabled:opacity-50"
                        >
                          やり直す
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {data && (tab === "pending" ? pending : processed).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    {tab === "pending" ? "確認待ちの明細はありません。" : "まだ処理した明細がありません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
