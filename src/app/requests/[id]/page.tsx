import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { ACTION_LABELS, getRequest, KIND_LABELS, STATUS_LABELS, type RequestKind } from "@/lib/approvals/service";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { RequestActions } from "./RequestActions";
import { AiCheckPanel, type AiCheckView } from "@/components/AiCheckPanel";
import { getCheck } from "@/lib/assistant/approvalCheck";

export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(d);

const STAMP: Record<string, string> = { APPROVE: "border-rose-500 text-rose-600", REJECT: "border-slate-500 text-slate-600", SKIP: "border-slate-300 text-slate-400" };

// 稟議書(印刷・PDF保存できる)と、承認・差戻しの操作
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const req = await getRequest(user, id);
  if (!req) notFound();
  // 承認する人(と管理者・経理担当)には、承認前のAIチェックを出す。承認待ちで自分の番なら開いたときに自動で作る
  const showCheck = req.canDecide || user.role !== "EMPLOYEE";
  const check = showCheck ? await getCheck("REQUEST", req.id, user.companyId) : null;

  const rows: [string, string][] = [
    ["申請番号", req.number],
    ["申請日", fmt(req.createdAt)],
    ["申請者", req.requesterName],
    ["種類", KIND_LABELS[req.kind as RequestKind] ?? req.kind],
    ["件名", req.title],
    ...(req.amount ? ([["金額(税込)", formatYen(req.amount)]] as [string, string][]) : []),
    ...(req.payee ? ([["購入先・支払先", req.payee]] as [string, string][]) : []),
    ...(req.leaveDate ? ([["休む日", `${day(req.leaveDate)}${req.leaveHalfDays === 1 ? "(半日)" : "(1日)"}`]] as [string, string][]) : []),
    ["状態", STATUS_LABELS[req.status] ?? req.status],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/requests" className="text-sm text-indigo-700 hover:underline">
          ← 申請・稟議
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-widest">{req.kind === "LEAVE" ? "休暇届" : "稟議書"}</h1>
            <p className="mt-1 text-xs text-slate-500">{req.company.name}</p>
          </div>
          {/* 承認欄(はんこの欄) */}
          <div className="flex flex-row-reverse flex-wrap gap-1">
            {req.steps.map((s, i) => (
              <div key={i} className="w-20 border border-slate-400 text-center">
                <div className="truncate border-b border-slate-400 bg-slate-50 px-1 py-0.5 text-[11px] print:bg-slate-100">{s.name}</div>
                <div className="flex h-16 items-center justify-center">
                  {s.action ? (
                    <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 text-[10px] leading-tight font-bold ${STAMP[s.action] ?? ""}`}>
                      <span>{ACTION_LABELS[s.action]}</span>
                      {s.at && <span className="font-normal">{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(s.at)}</span>}
                    </div>
                  ) : s.current ? (
                    <span className="text-[11px] text-amber-600">承認待ち</span>
                  ) : (
                    <span className="text-[11px] text-slate-300">-</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </header>

        <table className="mt-6 w-full border-collapse text-sm">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-y border-slate-300">
                <th className="w-32 bg-slate-50 px-3 py-2 text-left font-medium print:bg-slate-100">{label}</th>
                <td className="px-3 py-2 break-words">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-6">
          <h2 className="mb-1 text-xs font-semibold text-slate-600">{req.kind === "LEAVE" ? "理由・連絡事項" : "内容・理由"}</h2>
          <div className="min-h-24 rounded border border-slate-300 px-3 py-2 whitespace-pre-wrap">{req.body || "(なし)"}</div>
        </section>

        <section className="mt-6">
          <h2 className="mb-1 text-xs font-semibold text-slate-600">回覧の記録</h2>
          <ol className="divide-y border-y border-slate-300 text-xs">
            {req.actions.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 px-1 py-1.5">
                <span className="text-slate-500 tabular-nums">{fmt(a.createdAt)}</span>
                <span className="font-medium">{a.userName}</span>
                <span>{ACTION_LABELS[a.action] ?? a.action}</span>
                {a.comment && <span className="basis-full text-slate-700 whitespace-pre-wrap sm:basis-auto">「{a.comment}」</span>}
              </li>
            ))}
          </ol>
        </section>
        {req.kind === "LEAVE" && req.status === "APPROVED" && <p className="mt-4 text-xs text-emerald-700">承認されたため、有給休暇として登録しました。</p>}
      </article>

      {showCheck && (req.status === "PENDING" || check) && <AiCheckPanel type="REQUEST" id={req.id} initial={check as unknown as AiCheckView | null} auto={req.canDecide} />}

      <RequestActions id={req.id} canDecide={req.canDecide} canWithdraw={req.canWithdraw} />
    </div>
  );
}
