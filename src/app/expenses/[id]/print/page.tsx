import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { jpDate } from "@/components/BillingDocument";
import { jstDateKey } from "@/lib/jst";

export const dynamic = "force-dynamic";

// 作成日・精算日などの日時は日本時間の日付で表示する
function jstDate(d: Date) {
  const [y, m, day] = jstDateKey(d).split("-").map(Number);
  return `${y}年${m}月${day}日`;
}

const APPROVAL: Record<string, string> = { DRAFT: "未申請", SUBMITTED: "申請中", APPROVED: "承認済み", RETURNED: "差戻し" };

// 経費精算書(明細・合計・承認欄・レシート画像)。従業員は自分の精算書だけ開ける。
export default async function ExpenseReportPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  const report = await prisma.expenseReport.findFirst({
    where: { id, companyId: user.companyId, ...(user.role === "EMPLOYEE" ? { employeeId: user.id } : {}) },
    include: {
      company: { select: { name: true, expenseApprovalRequired: true } },
      employee: { select: { name: true } },
      items: { include: { account: { select: { code: true, name: true } }, vendor: { select: { name: true } } }, orderBy: { expenseDate: "asc" } },
    },
  });
  if (!report) notFound();
  const total = report.items.reduce((s, i) => s + i.amount, 0);
  const images = report.items.filter((i) => i.receiptImageUrl?.startsWith("data:image/"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/expenses" className="text-sm text-indigo-700 hover:underline">
          ← 経費精算に戻る
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-[0.3em]">経費精算書</h1>
            <p className="mt-2 text-sm">{report.company.name}</p>
          </div>
          <table className="border-collapse text-center text-xs">
            <tbody>
              <tr>
                {["申請者", "承認者", "経理"].map((h) => (
                  <th key={h} className="w-16 border border-slate-400 px-2 py-1 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
              <tr>
                {[0, 1, 2].map((i) => (
                  <td key={i} className="h-14 border border-slate-400" />
                ))}
              </tr>
            </tbody>
          </table>
        </header>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">申請者</dt>
            <dd>{report.employee.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">作成日</dt>
            <dd>{jstDate(report.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{report.company.expenseApprovalRequired ? "承認" : "申請日"}</dt>
            <dd>
              {report.company.expenseApprovalRequired
                ? `${APPROVAL[report.approvalStatus] ?? report.approvalStatus}${report.approvedByName ? `(${report.approvedByName})` : ""}`
                : report.submittedAt
                  ? jstDate(report.submittedAt)
                  : "-"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">精算日</dt>
            <dd>{report.reimbursedAt ? jstDate(report.reimbursedAt) : "未精算"}</dd>
          </div>
        </dl>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-400 text-left text-xs whitespace-nowrap">
                <th className="py-1.5 pr-2">No.</th>
                <th className="py-1.5 pr-2">日付</th>
                <th className="py-1.5 pr-2">内容</th>
                <th className="py-1.5 pr-2">支払先</th>
                <th className="py-1.5 pr-2">勘定科目</th>
                <th className="py-1.5 text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item, i) => (
                <tr key={item.id} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{i + 1}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{jpDate(item.expenseDate)}</td>
                  <td className="min-w-[8rem] py-1.5 pr-2">{item.description}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{item.vendor?.name ?? "-"}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{item.account ? item.account.name : "-"}</td>
                  <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{formatYen(item.amount)}</td>
                </tr>
              ))}
              {report.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-400">
                    明細がありません
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-b-2 border-slate-400 font-semibold">
                <td colSpan={5} className="py-2 pr-4 text-right">
                  合計
                </td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">{formatYen(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {report.returnComment && report.approvalStatus === "RETURNED" && <p className="mt-4 text-xs">差戻しの理由: {report.returnComment}</p>}

        {images.length > 0 && (
          <section className="mt-8 break-before-page">
            <h2 className="text-sm font-semibold">添付レシート</h2>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {images.map((item) => (
                <figure key={item.id} className="break-inside-avoid">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.receiptImageUrl!} alt={`${item.description}のレシート`} className="max-h-[110mm] w-full rounded border border-slate-200 object-contain" />
                  <figcaption className="mt-1 text-xs text-slate-600">
                    No.{report.items.indexOf(item) + 1} {jpDate(item.expenseDate)} {formatYen(item.amount)}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
