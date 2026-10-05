import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 取引先の重複: 「株式会社A」と「(株)A」のように同じ相手が2つ以上登録されているものを見つけ、1つにまとめる。
// ・会社の種類(株式会社・(株)・有限会社など)・空白・記号・全角半角の違いを除いて同じ名前 → 「同じ」(強い候補)
// ・片方の名前がもう片方に含まれる/1文字違い → 「似ている」(AIが同じ相手か見立てる)
// まとめると、請求書・経費・発注書・見積書などの付け先を残す方に移し、残す方にない情報(メール・住所・口座・登録番号など)を写して、
// まとめた方を消す。請求書・経費の付け替えは訂正削除の履歴に残る。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const NOT_DUP_KIND = "PARTY_NOT_DUP";
const NOTE_KIND = "PARTY_DUPLICATES";

export type PartyKind = "vendor" | "customer";
export type PartyInfo = { id: string; name: string; uses: number; details: string[] };
export type DupGroup = { key: string; kind: PartyKind; strength: "same" | "similar"; parties: PartyInfo[]; keepId: string; reason: string; aiNote: string | null; aiSame: boolean | null };

const LEGAL = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|医療法人|社会福祉法人|学校法人|\(株\)|\(有\)|\(同\)|㈱|㈲|カブシキガイシャ|ユウゲンガイシャ|ｶﾌﾞｼｷｶﾞｲｼｬ/g;

export function normalizeName(name: string) {
  return name
    .normalize("NFKC")
    .replace(LEGAL, "")
    .replace(/[\s　・.,、。'"`\-ー‐–—_()[\]【】「」]/g, "")
    .toLowerCase();
}

function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return a.length - i - j <= 1 && b.length - i - j <= 1;
}

const pairKey = (kind: PartyKind, ids: string[]) => `${kind}:${[...ids].sort().join(":")}`;

async function loadParties(companyId: string, kind: PartyKind): Promise<PartyInfo[]> {
  if (kind === "vendor") {
    const rows = await prisma.vendor.findMany({
      where: { companyId },
      select: { id: true, name: true, registrationNumber: true, payeeAccount: true, address: true, phone: true, defaultExpenseAccount: { select: { name: true } }, _count: { select: { invoices: true, expenseItems: true, purchaseOrders: true } } },
    });
    return rows.map((v) => ({
      id: v.id,
      name: v.name,
      uses: v._count.invoices + v._count.expenseItems + v._count.purchaseOrders,
      details: [`請求書 ${v._count.invoices}件・経費 ${v._count.expenseItems}件・発注書 ${v._count.purchaseOrders}件`, v.registrationNumber ? `登録番号 ${v.registrationNumber}` : "", v.payeeAccount ? "振込先の口座あり" : "", v.defaultExpenseAccount ? `いつもの科目 ${v.defaultExpenseAccount.name}` : "", v.address ?? "", v.phone ?? ""].filter(Boolean),
    }));
  }
  const rows = await prisma.customer.findMany({
    where: { companyId },
    select: { id: true, name: true, email: true, address: true, phone: true, creditLimit: true, _count: { select: { invoices: true, quotes: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    uses: c._count.invoices + c._count.quotes,
    details: [`請求書 ${c._count.invoices}件・見積書 ${c._count.quotes}件`, c.email ?? "", c.address ?? "", c.phone ?? "", c.creditLimit ? "与信限度額あり" : ""].filter(Boolean),
  }));
}

// 残す方: 使われている件数が多い方、同じなら情報が多い方、同じなら会社の種類まで書いてある(長い)名前
const keepOf = (ps: PartyInfo[]) => [...ps].sort((a, b) => b.uses - a.uses || b.details.length - a.details.length || b.name.length - a.name.length)[0].id;

export async function findDuplicateParties(companyId: string) {
  const notDup = new Set((await prisma.aiNote.findMany({ where: { companyId, kind: NOT_DUP_KIND }, select: { key: true } })).map((n) => n.key));
  const groups: DupGroup[] = [];
  for (const kind of ["vendor", "customer"] as const) {
    const parties = await loadParties(companyId, kind);
    const byNorm = new Map<string, PartyInfo[]>();
    for (const p of parties) {
      const n = normalizeName(p.name);
      if (!n) continue;
      byNorm.set(n, [...(byNorm.get(n) ?? []), p]);
    }
    for (const ps of byNorm.values()) {
      if (ps.length < 2) continue;
      const key = pairKey(kind, ps.map((p) => p.id));
      if (notDup.has(key)) continue;
      groups.push({ key, kind, strength: "same", parties: ps, keepId: keepOf(ps), reason: "会社の種類・空白・記号の違いを除くと同じ名前です", aiNote: null, aiSame: null });
    }
    // 似ている名前(正規化した名前どうしで、含む・1文字違い)
    const norms = [...byNorm.entries()].filter(([n]) => n.length >= 3);
    for (let i = 0; i < norms.length; i++) {
      for (let j = i + 1; j < norms.length; j++) {
        const [a, pa] = norms[i];
        const [b, pb] = norms[j];
        const contains = a.includes(b) || b.includes(a);
        const close = a.length >= 4 && b.length >= 4 && oneEditApart(a, b);
        if (!contains && !close) continue;
        const ps = [pa[0], pb[0]];
        const key = pairKey(kind, ps.map((p) => p.id));
        if (notDup.has(key)) continue;
        groups.push({ key, kind, strength: "similar", parties: ps, keepId: keepOf(ps), reason: contains ? "片方の名前がもう片方に含まれています" : "名前が1文字だけ違います", aiNote: null, aiSame: null });
      }
    }
  }
  groups.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "same" ? -1 : 1));
  return groups;
}

type NoteData = { summary: string; judgments: Record<string, { same: boolean; note: string }> };

export async function getDuplicateParties(companyId: string) {
  const [groups, note] = await Promise.all([findDuplicateParties(companyId), prisma.aiNote.findFirst({ where: { companyId, kind: NOTE_KIND }, orderBy: { key: "desc" } })]);
  const data = note ? (note.data as NoteData) : null;
  return {
    groups: groups.map((g) => {
      const j = data?.judgments?.[g.key];
      return j ? { ...g, aiNote: j.note, aiSame: j.same } : g;
    }),
    review: note && data ? { summary: data.summary, mode: note.mode, createdAt: note.createdAt.toISOString(), createdBy: note.createdBy } : null,
  };
}

export async function countDuplicateParties(companyId: string) {
  return (await findDuplicateParties(companyId)).filter((g) => g.strength === "same").length;
}

// 「別の相手」として候補から外す
export async function markNotDuplicate(user: { name: string; companyId: string }, key: string) {
  const groups = await findDuplicateParties(user.companyId);
  if (!groups.some((g) => g.key === key)) throw new UserError("その候補は見つかりません");
  await prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId: user.companyId, kind: NOT_DUP_KIND, key } },
    create: { companyId: user.companyId, kind: NOT_DUP_KIND, key, data: { status: "different" }, mode: "ok", createdBy: user.name },
    update: {},
  });
  return { ok: true };
}

// まとめる: mergeIds の取引先を keepId に寄せて消す
export async function mergeParties(companyId: string, kind: PartyKind, keepId: string, mergeIdsInput: unknown) {
  const mergeIds = [...new Set((Array.isArray(mergeIdsInput) ? mergeIdsInput : []).map(String))].filter((id) => id && id !== keepId);
  if (!mergeIds.length) throw new UserError("まとめる取引先を選んでください");
  if (mergeIds.length > 10) throw new UserError("一度にまとめられるのは10件までです");
  if (kind === "vendor") {
    const all = await prisma.vendor.findMany({ where: { companyId, id: { in: [keepId, ...mergeIds] } } });
    const keep = all.find((v) => v.id === keepId);
    const others = all.filter((v) => v.id !== keepId);
    if (!keep || others.length !== mergeIds.length) throw new UserError("取引先が見つかりません");
    const fill = {
      defaultExpenseAccountId: keep.defaultExpenseAccountId ?? others.find((o) => o.defaultExpenseAccountId)?.defaultExpenseAccountId ?? null,
      payeeAccount: keep.payeeAccount ?? others.find((o) => o.payeeAccount)?.payeeAccount ?? undefined,
      address: keep.address ?? others.find((o) => o.address)?.address ?? null,
      postalCode: keep.postalCode ?? others.find((o) => o.postalCode)?.postalCode ?? null,
      department: keep.department ?? others.find((o) => o.department)?.department ?? null,
      contactName: keep.contactName ?? others.find((o) => o.contactName)?.contactName ?? null,
      honorific: keep.honorific ?? others.find((o) => o.honorific)?.honorific ?? null,
      phone: keep.phone ?? others.find((o) => o.phone)?.phone ?? null,
      invoiceStatus: keep.invoiceStatus ?? others.find((o) => o.invoiceStatus)?.invoiceStatus ?? null,
      registrationNumber: keep.registrationNumber ?? others.find((o) => o.registrationNumber)?.registrationNumber ?? null,
    };
    const moved = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.updateMany({ where: { companyId, vendorId: { in: mergeIds } }, data: { vendorId: keepId } });
      const exp = await tx.expenseItem.updateMany({ where: { vendorId: { in: mergeIds }, expenseReport: { companyId } }, data: { vendorId: keepId } });
      const po = await tx.purchaseOrder.updateMany({ where: { companyId, vendorId: { in: mergeIds } }, data: { vendorId: keepId } });
      // AIが修正から覚えた記録(取引先IDで覚えているもの)
      await tx.aiCorrection.updateMany({ where: { companyId, kind: { in: ["EXPENSE", "INVOICE"] }, key: { in: mergeIds } }, data: { key: keepId } });
      await tx.vendor.update({ where: { id: keepId }, data: fill });
      await tx.vendor.deleteMany({ where: { companyId, id: { in: mergeIds } } });
      return { invoices: inv.count, expenseItems: exp.count, purchaseOrders: po.count };
    });
    return { keep: keep.name, merged: others.map((o) => o.name), moved };
  }
  const all = await prisma.customer.findMany({ where: { companyId, id: { in: [keepId, ...mergeIds] } } });
  const keep = all.find((c) => c.id === keepId);
  const others = all.filter((c) => c.id !== keepId);
  if (!keep || others.length !== mergeIds.length) throw new UserError("顧客が見つかりません");
  const pick = <K extends keyof typeof keep>(k: K) => keep[k] ?? others.find((o) => o[k] !== null && o[k] !== undefined)?.[k] ?? null;
  const moved = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.updateMany({ where: { companyId, customerId: { in: mergeIds } }, data: { customerId: keepId } });
    const quo = await tx.quote.updateMany({ where: { companyId, customerId: { in: mergeIds } }, data: { customerId: keepId } });
    // 名前で結び付いている商談・案件も、残す方の名前にそろえる
    const names = others.map((o) => o.name);
    const deals = await tx.deal.updateMany({ where: { companyId, customerName: { in: names } }, data: { customerName: keep.name } });
    await tx.project.updateMany({ where: { companyId, customerName: { in: names } }, data: { customerName: keep.name } });
    await tx.customer.update({
      where: { id: keepId },
      data: { payerName: pick("payerName"), email: pick("email"), address: pick("address"), postalCode: pick("postalCode"), department: pick("department"), contactName: pick("contactName"), honorific: pick("honorific"), phone: pick("phone"), creditLimit: pick("creditLimit") },
    });
    await tx.customer.deleteMany({ where: { companyId, id: { in: mergeIds } } });
    return { invoices: inv.count, quotes: quo.count, deals: deals.count };
  });
  return { keep: keep.name, merged: others.map((o) => o.name), moved };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "全体の一言(80字以内)" },
    judgments: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, same: { type: "boolean", description: "同じ相手と考えるなら true" }, note: { type: "string", description: "理由・確かめ方(60字以内)" } },
        required: ["index", "same", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "judgments"],
  additionalProperties: false,
} as const;

// AIに、似ている名前が同じ相手かどうかを見立ててもらう(まとめるのは人が押したときだけ)
export async function reviewDuplicateParties(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const groups = await findDuplicateParties(companyId);
  const same = groups.filter((g) => g.strength === "same").length;
  let summary = groups.length ? `同じ相手の重複が ${same}組、似ている名前が ${groups.length - same}組 あります。` : "重複している取引先は見つかりませんでした。";
  const judgments: NoteData["judgments"] = {};
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY && groups.length) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    const pick = groups.slice(0, 40);
    try {
      const response = await new Anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の取引先台帳を整理する担当者です。重複かもしれない取引先の組(JSON)を読み、同じ相手かどうかを見立て、理由や確かめ方を一言で書いてください。",
              "「山田商店」と「山田商事」のように似ていても別の会社はよくあります。名前だけで決めきれないときは same を false にし、登録番号・住所・電話で確かめるよう書いてください。登録番号や住所が違えば別の相手です。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(pick.map((g, index) => ({ index, kind: g.kind === "vendor" ? "仕入先・支払先" : "顧客", rule: g.strength === "same" ? "名前の表記ゆれ" : "似ている名前", parties: g.parties.map((p) => ({ name: p.name, details: p.details })) }))) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim(),
        ) as { summary?: unknown; judgments?: unknown };
        for (const x of Array.isArray(raw.judgments) ? raw.judgments : []) {
          const j = x as { index?: unknown; same?: unknown; note?: unknown };
          const g = Number.isInteger(Number(j.index)) ? pick[Number(j.index)] : undefined;
          const note = String(j.note ?? "").trim().slice(0, 120);
          if (g && note) judgments[g.key] = { same: j.same === true, note };
        }
        const s = String(raw.summary ?? "").trim().slice(0, 160);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "取引先の重複", tools: [], mode: `parties-${mode}` } });
  }
  const today = jstDateKey(new Date());
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: today } },
    create: { companyId, kind: NOTE_KIND, key: today, data: { summary, judgments }, mode, createdBy: user.name },
    update: { data: { summary, judgments }, mode, createdBy: user.name, createdAt: new Date() },
  });
}
