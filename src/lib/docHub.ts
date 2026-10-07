import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";

// 「AIで書類を作る」: あちこちの画面にある書類づくり(規程・契約書・求人票・挨拶状・議事録・マニュアル・督促文など)を一か所にまとめる。
// AIアシスタントの「◯◯を作りたい」にも、ここの一覧から合う画面を案内する。

export type DocTool = {
  href: string;
  title: string;
  description: string;
  category: "outside" | "inside" | "people" | "money";
  keywords: string[];
  logPrefix?: string; // AssistantLog の mode の頭(今月の利用回数を数える)
  ai: boolean; // AIで書き直し・下書きができる
};

export const DOC_CATEGORIES: Record<DocTool["category"], string> = { outside: "社外に出す書類", inside: "社内の書類", people: "人・採用", money: "お金・取引" };

export const DOC_TOOLS: DocTool[] = [
  { href: "/letters/greeting", title: "挨拶状・お礼状", description: "お礼・年末年始の休業・移転・担当者交代・お詫び・新しいご案内を、拝啓〜敬具の形で。", category: "outside", keywords: ["挨拶状", "お礼状", "お礼", "休業", "年末年始", "移転", "担当者", "お詫び", "詫び状", "案内状"], logPrefix: "greeting-", ai: true },
  { href: "/mail-reply", title: "メールの返信", description: "届いたメールの用件を見分け、請求・入金・見積の状況をそろえた返信の下書き。", category: "outside", keywords: ["返信", "メール返信", "メールの返信", "返事", "問い合わせ"], logPrefix: "mail-reply-", ai: true },
  { href: "/letters", title: "送付状・封筒・宛名ラベル", description: "書類に添える送付状と、封筒(長形3号)・宛名ラベルの印刷。", category: "outside", keywords: ["送付状", "封筒", "宛名", "ラベル", "添え状"], ai: false },
  { href: "/contracts/draft", title: "契約書のひな形", description: "秘密保持・業務委託・取引基本契約。印紙・フリーランスへの委託のチェックつき。", category: "outside", keywords: ["契約書", "契約", "秘密保持", "NDA", "業務委託", "取引基本", "ひな形"], logPrefix: "contract-draft-", ai: true },
  { href: "/quotes/ai", title: "見積書(AI見積アシスト)", description: "やりたいことを書くと、過去の見積・請求から品目と金額の下書きを作る。", category: "outside", keywords: ["見積", "見積書", "見積もり"], logPrefix: "quote-", ai: true },
  { href: "/collections", title: "督促メール", description: "期日を過ぎた請求の、相手に合わせた督促文。", category: "money", keywords: ["督促", "催促", "入金のお願い", "未入金"], logPrefix: "reminder-", ai: true },
  { href: "/price-review", title: "値上げのお知らせ", description: "原価の上がり方から値上げ幅を考え、取引先へのお知らせ文を作る。", category: "money", keywords: ["値上げ", "価格改定", "値上げのお知らせ"], logPrefix: "price-", ai: true },
  { href: "/loan-application", title: "融資相談の資料", description: "銀行に出す事業の説明・資金の使いみち・返済の見通し。", category: "money", keywords: ["融資", "借入", "銀行", "資金調達", "事業計画"], logPrefix: "loan-doc-", ai: true },
  { href: "/minutes/new", title: "議事録", description: "会議のメモから、決まったこと・やること(担当・期限)を整理。", category: "inside", keywords: ["議事録", "会議", "打ち合わせ", "ミーティング"], logPrefix: "minutes-", ai: true },
  { href: "/manuals", title: "マニュアル", description: "メモから手順書の下書き。やさしい日本語・英語版・わかりにくい所のチェックも。", category: "inside", keywords: ["マニュアル", "手順書", "やさしい日本語", "英語", "翻訳"], logPrefix: "manual-", ai: true },
  { href: "/policies", title: "社内規程", description: "経費精算規程・在宅勤務規程・慶弔見舞金規程。", category: "inside", keywords: ["規程", "規則", "ルール", "経費精算規程", "在宅勤務", "テレワーク", "慶弔"], logPrefix: "policy-", ai: true },
  { href: "/travel/policy", title: "出張旅費規程", description: "設定した日当・宿泊費で作る出張旅費規程。", category: "inside", keywords: ["出張", "旅費", "日当", "出張旅費規程"], ai: false },
  { href: "/compliance/rules", title: "電子帳簿保存法の事務処理規程", description: "訂正削除の防止に関する事務処理規程。", category: "inside", keywords: ["電子帳簿", "電帳法", "事務処理規程"], ai: false },
  { href: "/notices", title: "社内のお知らせ", description: "全員に知らせたいこと(読んだ人がわかる)。", category: "inside", keywords: ["お知らせ", "周知", "社内連絡"], ai: false },
  { href: "/job-posting", title: "求人票", description: "求人票の下書きと、年齢・性別で限る言い方のチェック。", category: "people", keywords: ["求人", "求人票", "募集", "採用", "アルバイト募集"], logPrefix: "job-", ai: true },
  { href: "/hr-procedures", title: "入社・退職の案内", description: "本人に送る、用意するもの・返すもの・渡すものの案内。", category: "people", keywords: ["入社", "退職", "入社案内", "退職案内"], logPrefix: "hr-guide-", ai: true },
  { href: "/staff-records", title: "労働条件通知書・労働者名簿", description: "雇うときに渡す労働条件通知書と、法定の名簿・賃金台帳。", category: "people", keywords: ["労働条件通知書", "雇用契約", "労働者名簿", "賃金台帳"], ai: false },
];

// 「◯◯を作りたい」に合う画面(言葉が多く当たる順)
export function findDocTools(text: string, limit = 3) {
  const q = text.toLowerCase();
  return DOC_TOOLS.map((t) => ({ t, score: t.keywords.filter((k) => q.includes(k.toLowerCase())).reduce((s, k) => s + k.length, 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

// 今月の AI での作成回数(画面ごと)
export async function getDocUsage(companyId: string, today = jstDateKey(new Date())) {
  const since = new Date(`${today.slice(0, 7)}-01T00:00:00+09:00`);
  const rows = await prisma.assistantLog.groupBy({ by: ["mode"], where: { companyId, createdAt: { gte: since } }, _count: { _all: true } });
  const usage: Record<string, number> = {};
  for (const t of DOC_TOOLS) {
    if (!t.logPrefix) continue;
    // contract- と contract-draft- のように頭がかぶるものは、長い方だけに数える
    const longer = DOC_TOOLS.filter((o) => o.logPrefix && o.logPrefix !== t.logPrefix && o.logPrefix.startsWith(t.logPrefix!)).map((o) => o.logPrefix!);
    usage[t.href] = rows.filter((r) => r.mode?.startsWith(t.logPrefix!) && !longer.some((l) => r.mode?.startsWith(l))).reduce((s, r) => s + r._count._all, 0);
  }
  return usage;
}
