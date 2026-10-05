import { formatYen } from "@/lib/format";
import { buildCashFacts, riskOf } from "@/lib/assistant/cashAdvice";
import { listContracts } from "@/lib/contracts";
import { findCustomerInsights } from "@/lib/customerInsights";
import { findVendorInsights } from "@/lib/vendorInsights";
import { getPoMatches } from "@/lib/poMatching";
import { getCollections } from "@/lib/collections";
import { countAnomalies } from "@/lib/anomalies";
import { countDuplicates } from "@/lib/duplicates";
import { runBookCheck } from "@/lib/bookCheck";
import { getAccountReview } from "@/lib/accountReview";
import { findBillingGaps } from "@/lib/billingGaps";

// AIの見張り: 会社のいろいろな見守り(資金・契約・顧客・仕入先・督促・発注書・異常・二重計上・帳簿・科目・請求漏れ)の結果を1か所に集める。
// 「AIの見張り」画面と、毎朝のブリーフィングで使う。

export type WatchStatus = "ok" | "info" | "warn";
export type Watch = { key: string; label: string; status: WatchStatus; headline: string; href: string; items: string[] };

export async function getWatches(companyId: string): Promise<Watch[]> {
  const [cash, contracts, customers, vendors, po, collections, anomalies, duplicates, book, accounts, billing] = await Promise.all([
    buildCashFacts(companyId),
    listContracts(companyId),
    findCustomerInsights(companyId),
    findVendorInsights(companyId),
    getPoMatches(companyId),
    getCollections(companyId),
    countAnomalies(companyId),
    countDuplicates(companyId),
    runBookCheck(companyId),
    getAccountReview(companyId),
    findBillingGaps(companyId),
  ]);
  const risk = riskOf(cash);
  const soon = contracts.contracts.filter((c) => c.status === "ACTIVE" && (c.daysToDeadline ?? c.daysToEnd ?? 999) >= 0 && (c.daysToDeadline ?? c.daysToEnd ?? 999) <= 30);
  const custWarn = customers.insights.filter((i) => i.level === "warn");
  const vendWarn = vendors.insights.filter((i) => i.level === "warn");
  const poIssues = po.filter((r) => r.kind === "DOUBLE" || r.kind === "MISMATCH");
  const late = collections.rows.filter((r) => r.stage === "CALL" || r.stage === "LEGAL");
  const bookWarn = book.findings.filter((f) => f.level === "warn");
  return [
    {
      key: "cash",
      label: "資金繰り",
      status: risk === "HIGH" ? "warn" : risk === "MEDIUM" ? "info" : "ok",
      headline: cash.shortageMonth ? `${cash.shortageMonth} 末に資金が足りなくなる見込みです` : risk === "MEDIUM" ? `最も低い月末残高が ${formatYen(cash.lowest?.closing ?? 0)} まで下がる見込みです` : "この3か月は資金に余裕がありそうです",
      href: "/cashflow",
      items: [],
    },
    {
      key: "contracts",
      label: "契約の期限",
      status: soon.length ? "warn" : "ok",
      headline: soon.length ? `30日以内に解約・更新の判断が必要な契約が ${soon.length}件 あります` : "30日以内に判断が必要な契約はありません",
      href: "/contracts",
      items: soon.slice(0, 5).map((c) => `${c.title}(${c.counterparty ?? "-"}): ${c.deadline ? `申し出期限 ${c.deadline}` : `満了 ${c.nextEnd}`}`),
    },
    {
      key: "collections",
      label: "督促・回収",
      status: late.length ? "warn" : collections.rows.length ? "info" : "ok",
      headline: collections.rows.length ? `期限を過ぎた未入金が ${formatYen(collections.total)}(${collections.rows.length}件)。電話・要相談の段階が ${late.length}件` : "期限を過ぎた未入金はありません",
      href: "/collections",
      items: late.slice(0, 5).map((r) => `${r.customer?.name ?? "-"}: ${formatYen(r.remaining)}(${r.daysOverdue}日過ぎ)`),
    },
    {
      key: "customers",
      label: "顧客の見守り",
      status: custWarn.length ? "warn" : customers.insights.length ? "info" : "ok",
      headline: customers.insights.length ? `気になる顧客の変化が ${custWarn.length}件(そのほか ${customers.insights.length - custWarn.length}件)` : "目立った変化のある顧客はいません",
      href: "/customer-insights",
      items: custWarn.slice(0, 5).map((i) => i.title),
    },
    {
      key: "vendors",
      label: "仕入先の見守り",
      status: vendWarn.length ? "warn" : vendors.insights.length ? "info" : "ok",
      headline: vendors.insights.length ? `気になる仕入先の変化が ${vendWarn.length}件(そのほか ${vendors.insights.length - vendWarn.length}件)` : "目立った変化のある仕入先はありません",
      href: "/vendor-insights",
      items: vendWarn.slice(0, 5).map((i) => i.title),
    },
    {
      key: "po",
      label: "発注書と請求書",
      status: poIssues.length ? "warn" : "ok",
      headline: poIssues.length ? `発注書と金額が違う・二重の疑いがある請求書が ${poIssues.length}件` : "発注書と合わない請求書はありません",
      href: "/po-matching",
      items: poIssues.slice(0, 5).map((r) => `${r.vendor}: ${r.message}`),
    },
    {
      key: "anomalies",
      label: "いつもと違う動き",
      status: anomalies ? "info" : "ok",
      headline: anomalies ? `いつもと違うお金の動きが ${anomalies}件` : "いつもと違うお金の動きはありません",
      href: "/anomalies",
      items: [],
    },
    {
      key: "duplicates",
      label: "二重計上",
      status: duplicates ? "warn" : "ok",
      headline: duplicates ? `二重計上かもしれないものが ${duplicates}組` : "二重計上の疑いはありません",
      href: "/duplicates",
      items: [],
    },
    {
      key: "book",
      label: "帳簿の健康診断",
      status: bookWarn.length ? "warn" : book.findings.length ? "info" : "ok",
      headline: `帳簿の点数は ${book.score}点${bookWarn.length ? `(要注意 ${bookWarn.length}件)` : ""}`,
      href: "/book-check",
      items: bookWarn.slice(0, 5).map((f) => f.title),
    },
    {
      key: "billing",
      label: "請求漏れ",
      status: billing.gaps.some((g) => g.level === "warn") ? "warn" : billing.gaps.length ? "info" : "ok",
      headline: billing.gaps.length ? `出し忘れかもしれない請求が ${billing.gaps.length}件` : "請求漏れは見つかりません",
      href: "/billing-gaps",
      items: billing.gaps.slice(0, 5).map((g) => g.title),
    },
    {
      key: "accounts",
      label: "科目の見直し",
      status: accounts.suggestions.length ? "info" : "ok",
      headline: accounts.suggestions.length ? `勘定科目を見直したい経費の仕訳が ${accounts.suggestions.length}件` : "科目が違いそうな経費の仕訳はありません",
      href: "/account-review",
      items: accounts.suggestions.slice(0, 5).map((s) => `${s.date} ${s.description}: ${s.from.name} → ${s.to.name}`),
    },
  ];
}
