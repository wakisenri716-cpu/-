"use client";

import { useState } from "react";
import { ManualBody } from "@/components/ManualBody";

type Mode = "draft" | "easy" | "english" | "check";
type TextResult = { mode: Mode; title: string; body: string; via: "claude" | "template" };
type CheckResult = { mode: "check"; points: { where: string; issue: string; suggestion: string }[] };

const SUFFIX: Record<"easy" | "english", string> = { easy: "(やさしい日本語)", english: "(English)" };

// マニュアルを書く画面の「AIで手伝う」。メモから下書き・やさしい日本語・英語版・わかりにくい所のチェック
export default function ManualAssist({ ai, title, body, onReplace, onCopyAsNew }: { ai: boolean; title: string; body: string; onReplace: (title: string, body: string) => void; onCopyAsNew: (title: string, body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TextResult | CheckResult | null>(null);

  async function run(mode: Mode) {
    if (mode === "draft" && body.trim() && !confirm("いまの本文を、メモから作った下書きで置き換えます。よろしいですか?")) return;
    setBusy(mode);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/manuals/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, title, notes, body }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      if (mode === "draft") {
        onReplace(data.title, data.body);
        setNotes("");
        setResult({ ...data, body: "" });
      } else setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const btn = "rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50";
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-indigo-700 hover:underline">
        {ai ? "AIで手伝う(メモから下書き・やさしい日本語・英語版・チェック)" : "メモから下書きを作る"}
      </button>
    );
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-indigo-900">{ai ? "AIで手伝う" : "メモから下書きを作る"}</p>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          閉じる
        </button>
      </div>
      <label className="block text-sm">
        <span className="text-slate-600">走り書きのメモ(1行に1つ。「準備: 〜」「注意: 〜」も書けます)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={20000} placeholder={"準備: ゴミ袋、軍手\n火の元を確認\nレジを締める\n注意: 最後の人は必ず鍵を2回確認"} className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => run("draft")} disabled={!!busy || !notes.trim()} className={btn}>
          {busy === "draft" ? "作っています…" : "メモから下書きを作る"}
        </button>
        {ai && (
          <>
            <button onClick={() => run("easy")} disabled={!!busy || !body.trim()} className={btn}>
              {busy === "easy" ? "書き直しています…" : "やさしい日本語にする"}
            </button>
            <button onClick={() => run("english")} disabled={!!busy || !body.trim()} className={btn}>
              {busy === "english" ? "翻訳しています…" : "英語版を作る"}
            </button>
            <button onClick={() => run("check")} disabled={!!busy || !body.trim()} className={btn}>
              {busy === "check" ? "チェックしています…" : "わかりにくい所をチェック"}
            </button>
          </>
        )}
      </div>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {result?.mode === "draft" && <p className="text-xs text-slate-600">{(result as TextResult).via === "claude" ? "AIが下書きを本文に入れました。" : "ルールで手順に並べて本文に入れました。"}「(確認: …)」の所や数字を確かめてください。</p>}
      {result && (result.mode === "easy" || result.mode === "english") && (
        <div className="space-y-2">
          <div className="max-h-72 overflow-y-auto rounded-md border bg-white p-3">
            <ManualBody body={(result as TextResult).body} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onCopyAsNew(`${title || (result as TextResult).title}${SUFFIX[result.mode as "easy" | "english"]}`, (result as TextResult).body)} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700">
              別のマニュアルにする(下書き)
            </button>
            <button onClick={() => onReplace(title, (result as TextResult).body)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              いまの本文と置き換える
            </button>
          </div>
        </div>
      )}
      {result?.mode === "check" &&
        ((result as CheckResult).points.length === 0 ? (
          <p className="text-sm text-emerald-800">わかりにくい所は見つかりませんでした。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(result as CheckResult).points.map((p, i) => (
              <li key={i} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-amber-900">
                  {p.where && <span className="mr-1 font-medium">[{p.where}]</span>}
                  {p.issue}
                </p>
                {p.suggestion && <p className="mt-0.5 text-slate-700">→ {p.suggestion}</p>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
