import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { normalizeName } from "@/lib/partyMerge";
import { MailError, appUrl, sendMail } from "@/lib/mail";
import { MEMO_ACTIONS, MEMO_KINDS, type MemoAction, type MemoKind } from "@/lib/phoneMemoLabels";

// 伝言メモ(電話・来客): 受けた人が走り書きを入れると、相手の会社・名前・電話番号・用件・折り返しの要否・急ぎかを分けて、
// 宛先の人に残す。宛先の人のやることリスト(ダッシュボード・朝のまとめ)に出て、メールでも知らせられる。済んだら「対応済み」に。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);


export type MemoFields = {
  kind: MemoKind;
  callerCompany: string | null;
  callerName: string | null;
  callerPhone: string | null;
  partyKind: "customer" | "vendor" | null;
  partyId: string | null;
  forUserId: string | null;
  message: string;
  action: MemoAction;
  urgent: boolean;
};

type Member = { id: string; name: string; email: string | null };
type Party = { kind: "customer" | "vendor"; id: string; name: string; phone: string | null };

const PHONE = /(?:\+81[\s-]?)?0\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}/;
const clean = (v: unknown, max: number) => {
  const s = String(v ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
};
const digitsOf = (s: string) => s.replace(/\D/g, "");

export async function memoContext(companyId: string) {
  const [users, customers, vendors] = await Promise.all([
    prisma.user.findMany({ where: { companyId, active: true, role: { not: "ADVISOR" } }, select: { id: true, name: true, email: true }, orderBy: { createdAt: "asc" } }),
    prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true, phone: true } }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true, phone: true } }),
  ]);
  const parties: Party[] = [...customers.map((c) => ({ kind: "customer" as const, ...c })), ...vendors.map((v) => ({ kind: "vendor" as const, ...v }))];
  return { users: users as Member[], parties };
}

// 住所録の相手(会社名か電話番号が同じ)
function findParty(parties: Party[], text: string, phone: string | null) {
  if (phone) {
    const p = parties.find((x) => x.phone && digitsOf(x.phone) === digitsOf(phone));
    if (p) return p;
  }
  const flat = normalizeName(text);
  return (
    parties
      .map((p) => ({ p, key: normalizeName(p.name) }))
      .filter((x) => x.key.length >= 2 && flat.includes(x.key))
      .sort((a, b) => b.key.length - a.key.length)[0]?.p ?? null
  );
}

// 宛先(「田中さんへ」「田中部長宛」、または名字が書いてある)
function findMember(users: Member[], text: string, exclude: string | null) {
  const t = text.normalize("NFKC");
  const scored = users
    .map((u) => {
      const family = u.name.normalize("NFKC").split(/[\s ]/)[0];
      if (family.length < 2 || (exclude && exclude.startsWith(family))) return { u, score: 0 };
      if (new RegExp(`${family}\\S{0,4}(へ|宛|あて|に伝言|に伝えて)`).test(t)) return { u, score: 2 };
      return { u, score: t.includes(family) ? 1 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.u ?? null;
}

// 走り書きから項目を分ける(AIを使わない)
export function templateMemo(text: string, ctx: { users: Member[]; parties: Party[] }): MemoFields {
  const t = text.normalize("NFKC").replace(/\r\n/g, "\n").trim();
  const phone = t.match(PHONE)?.[0].replace(/[()\s]/g, "-").replace(/-+/g, "-") ?? null;
  const party = findParty(ctx.parties, t, phone);
  const company = party?.name ?? t.match(/(?:株式会社|有限会社|合同会社|\(株\)|\(有\))[^\s、。,のから]{1,20}|[^\s、。,]{1,20}(?:株式会社|有限会社|合同会社|\(株\)|\(有\))/)?.[0] ?? null;
  const caller = t.match(/(?:^|[\s、。のでから])([\p{sc=Han}\p{sc=Katakana}ー]{1,6})\s?(?:さん|様|氏)(?:から|より|が|来社|来られ|お見え|、|より)/u)?.[1] ?? null;
  // 「日本運輸の木村様」のように、名前の前の「◯◯の」を会社名とみなす
  const companyBefore = !company && caller ? (t.match(new RegExp(`([^\\s、。,]{2,15})の\\s?${caller}`))?.[1]?.replace(/^.*(?:宛て?|あて|へ|時に|分に)/, "") ?? null) : null;
  const member = findMember(ctx.users, t, caller);
  const action: MemoAction = /折り?返し|(お電話|電話|連絡|ご連絡)(を)?(ください|下さい|ほしい|欲しい|いただきたい|お願い)/.test(t)
    ? "CALLBACK"
    : /(また|改めて|あらためて|後ほど|のちほど|後で|明日).{0,8}(電話|かけ|連絡し|ご連絡)/.test(t)
      ? "WILL_CALL"
      : phone
        ? "CALLBACK"
        : "FYI";
  return {
    kind: /来社|来客|来られ|お見え|訪問|ご来店|来店/.test(t) ? "VISIT" : "CALL",
    callerCompany: clean(company ?? companyBefore, 60),
    callerName: clean(caller, 30),
    callerPhone: phone,
    partyKind: party?.kind ?? null,
    partyId: party?.id ?? null,
    forUserId: member?.id ?? null,
    message: t.slice(0, 1000),
    action,
    urgent: /急ぎ|至急|大至急|今日中|本日中|すぐに|早めに|早急/.test(t),
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["CALL", "VISIT"], description: "電話か来客か" },
    callerCompany: { type: ["string", "null"], description: "相手の会社名(わかれば)" },
    callerName: { type: ["string", "null"], description: "相手の名前(わかれば。敬称は付けない)" },
    callerPhone: { type: ["string", "null"], description: "折り返し先の電話番号(メモに書いてあるときだけ)" },
    forName: { type: ["string", "null"], description: "伝言の宛先(社内の人の名前。members から選ぶ。わからなければ null)" },
    message: { type: "string", description: "用件を、宛先の人が読んですぐわかるように1〜3文で。メモにないことは書かない" },
    action: { type: "string", enum: ["CALLBACK", "WILL_CALL", "FYI"], description: "折り返し希望 / 相手がまた電話する / 伝言のみ" },
    urgent: { type: "boolean", description: "急ぎ・至急・今日中などと書いてあるか" },
  },
  required: ["kind", "callerCompany", "callerName", "callerPhone", "forName", "message", "action", "urgent"],
  additionalProperties: false,
} as const;

export async function parseMemo(user: { id: string; companyId: string }, raw: Record<string, unknown>) {
  const text = String(raw.text ?? "").trim().slice(0, 2000);
  if (!text) throw new UserError("伝言の内容を書いてください");
  const ctx = await memoContext(user.companyId);
  const base = templateMemo(text, ctx);
  if (raw.useAi !== true) return { fields: base, mode: "template" as const };

  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: { fields: MemoFields; mode: "claude" | "template" } = { fields: base, mode: "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: [
            "あなたは会社の電話番です。電話・来客の走り書きのメモ(memo)を、宛先の人に残す伝言メモの項目に分けます。",
            "メモに書いてあることだけを使い、書いていない名前・電話番号・約束は作らないでください。宛先は社内の人(members)から選んでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ memo: text, members: ctx.users.map((u) => u.name) }) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const p = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as Record<string, unknown>;
      // 電話番号はメモにある数字のときだけ使う
      const phoneRaw = clean(p.callerPhone, 30);
      const phone = phoneRaw && PHONE.test(phoneRaw) && digitsOf(text.normalize("NFKC")).includes(digitsOf(phoneRaw)) ? phoneRaw.match(PHONE)![0] : base.callerPhone;
      const company = clean(p.callerCompany, 60);
      const party = findParty(ctx.parties, `${company ?? ""} ${text}`, phone);
      const forName = clean(p.forName, 60);
      const member = forName ? (ctx.users.find((u) => u.name === forName) ?? findMember(ctx.users, forName, null)) : null;
      const message = clean(String(p.message ?? "").replace(/\n+/g, " "), 1000);
      result = {
        fields: {
          kind: p.kind === "VISIT" ? "VISIT" : "CALL",
          callerCompany: party?.name ?? company,
          callerName: clean(p.callerName, 30)?.replace(/(さん|様|氏)$/, "") ?? null,
          callerPhone: phone,
          partyKind: party?.kind ?? null,
          partyId: party?.id ?? null,
          forUserId: member?.id ?? base.forUserId,
          message: message ?? base.message,
          action: p.action === "WILL_CALL" || p.action === "FYI" ? p.action : "CALLBACK",
          urgent: p.urgent === true || base.urgent,
        },
        mode: "claude",
      };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "伝言メモの整理", tools: [], mode: `memo-${result.mode}` } });
  return result;
}

export async function createMemo(user: { id: string; companyId: string; name: string }, raw: Record<string, unknown>, request?: Request) {
  const message = String(raw.message ?? "").replace(/\r\n/g, "\n").trim().slice(0, 1000);
  if (!message) throw new UserError("用件を書いてください");
  const ctx = await memoContext(user.companyId);
  const forUserId = typeof raw.forUserId === "string" && raw.forUserId ? raw.forUserId : null;
  const member = forUserId ? ctx.users.find((u) => u.id === forUserId) : null;
  if (forUserId && !member) throw new UserError("宛先の人が見つかりません");
  const partyKind = raw.partyKind === "customer" || raw.partyKind === "vendor" ? raw.partyKind : null;
  const party = partyKind && typeof raw.partyId === "string" ? ctx.parties.find((p) => p.kind === partyKind && p.id === raw.partyId) : null;
  const phone = clean(raw.callerPhone, 30);
  const memo = await prisma.phoneMemo.create({
    data: {
      companyId: user.companyId,
      kind: raw.kind === "VISIT" ? "VISIT" : "CALL",
      callerCompany: clean(raw.callerCompany, 60) ?? party?.name ?? null,
      callerName: clean(raw.callerName, 30),
      callerPhone: phone && PHONE.test(phone) ? phone : null,
      partyKind: party ? party.kind : null,
      partyId: party ? party.id : null,
      forUserId: member?.id ?? null,
      forName: member?.name ?? null,
      message,
      action: raw.action === "WILL_CALL" || raw.action === "FYI" ? raw.action : "CALLBACK",
      urgent: raw.urgent === true,
      takenByName: user.name,
    },
  });
  let mailed = false;
  if (raw.notify === true && member?.email && member.id !== user.id) {
    try {
      await sendMail({
        companyId: user.companyId,
        kind: "NOTICE",
        to: member.email,
        subject: `${memo.urgent ? "【至急】" : ""}【伝言】${memoTitle(memo)}`,
        text: `${member.name}さん\n\n${user.name}さんが${MEMO_KINDS[memo.kind as MemoKind]}の伝言を受けました。\n\n${memoText(memo)}\n\n伝言メモ: ${appUrl(request)}/phone-memos\n`,
        sentByName: user.name,
        relatedId: memo.id,
      });
      mailed = true;
    } catch (error) {
      if (!(error instanceof MailError)) throw error;
    }
  }
  return { memo, mailed };
}

type MemoRow = { kind: string; callerCompany: string | null; callerName: string | null; callerPhone: string | null; message: string; action: string; urgent: boolean; createdAt: Date };
export const memoTitle = (m: Pick<MemoRow, "callerCompany" | "callerName">) => [m.callerCompany, m.callerName ? `${m.callerName}様` : null].filter(Boolean).join(" ") || "お名前なし";
export function memoText(m: MemoRow) {
  const at = new Date(m.createdAt.getTime() + 9 * 3_600_000).toISOString();
  return [
    `受けた日時: ${Number(at.slice(5, 7))}月${Number(at.slice(8, 10))}日 ${at.slice(11, 16)}`,
    `相手: ${memoTitle(m)}`,
    m.callerPhone ? `電話番号: ${m.callerPhone}` : null,
    `用件: ${m.message}`,
    `${MEMO_ACTIONS[m.action as MemoAction] ?? ""}${m.urgent ? "(至急)" : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function listMemos(companyId: string, viewerId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.phoneMemo.findMany({ where: { companyId, OR: [{ status: "OPEN" }, { doneAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 200 });
  const rank = (m: (typeof rows)[number]) => (m.status !== "OPEN" ? 3 : m.forUserId === viewerId ? 0 : m.forUserId === null ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || Number(b.urgent) - Number(a.urgent) || b.createdAt.getTime() - a.createdAt.getTime());
}

export async function updateMemo(companyId: string, id: string, raw: Record<string, unknown>) {
  const memo = await prisma.phoneMemo.findFirst({ where: { id, companyId } });
  if (!memo) throw new UserError("伝言メモが見つかりません");
  if (raw.status === "DONE") return prisma.phoneMemo.update({ where: { id }, data: { status: "DONE", doneAt: new Date(), doneNote: clean(raw.doneNote, 300) } });
  if (raw.status === "OPEN") return prisma.phoneMemo.update({ where: { id }, data: { status: "OPEN", doneAt: null, doneNote: null } });
  throw new UserError("変更の内容がありません");
}

export async function deleteMemo(companyId: string, id: string) {
  const { count } = await prisma.phoneMemo.deleteMany({ where: { id, companyId } });
  if (!count) throw new UserError("伝言メモが見つかりません");
}

// やることリスト: 自分あて・宛先なしの、対応していない伝言(user がなければ全部)
export async function countOpenMemos(companyId: string, userId?: string) {
  const where = { companyId, status: "OPEN", ...(userId ? { OR: [{ forUserId: userId }, { forUserId: null }] } : {}) };
  const [count, urgent] = await Promise.all([prisma.phoneMemo.count({ where }), prisma.phoneMemo.count({ where: { ...where, urgent: true } })]);
  return { count, urgent };
}
