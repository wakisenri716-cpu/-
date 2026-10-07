import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { normalizeName } from "@/lib/partyMerge";

// 名刺の取り込み: 名刺の写真(1枚に何枚写っていてもよい)からAIが会社名・部署・役職・氏名・メール・電話・住所を読み取り、
// 顧客・仕入先(住所録)に登録する。同じ相手がもう登録されていれば、空いている項目だけを名刺の内容で埋める。
// AIが使えないときは、名刺の文字を貼り付け(または入力)すると、メール・電話・郵便番号などを見分けて項目に分ける。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CARDS = 10;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type CardFields = {
  company: string | null;
  department: string | null;
  title: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  postalCode: string | null;
  address: string | null;
  website: string | null;
};
export type PartyKind = "customer" | "vendor";
export type CardMatch = { kind: PartyKind; id: string; name: string; reason: string; contactName: string | null; email: string | null; phone: string | null; address: string | null };

const KEYS: (keyof CardFields)[] = ["company", "department", "title", "name", "email", "phone", "mobile", "postalCode", "address", "website"];

const SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      description: "写っている名刺ごとに1つ(最大10枚)",
      items: {
        type: "object",
        properties: {
          company: { type: ["string", "null"], description: "会社・団体の名前(株式会社なども含めて書かれているとおり)" },
          department: { type: ["string", "null"], description: "部署(例: 営業部 第二課)" },
          title: { type: ["string", "null"], description: "役職(例: 部長)" },
          name: { type: ["string", "null"], description: "氏名(漢字があれば漢字。姓と名の間は半角空白1つ)" },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"], description: "会社・部署の電話番号(FAXは入れない)" },
          mobile: { type: ["string", "null"], description: "携帯電話の番号" },
          postalCode: { type: ["string", "null"], description: "郵便番号 123-4567" },
          address: { type: ["string", "null"], description: "住所(郵便番号は除く。ビル名も含める)" },
          website: { type: ["string", "null"] },
        },
        required: KEYS,
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

const str = (v: unknown, max: number) => {
  const s = String(v ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const PHONE = /(?:\+81[\s-]?)?0\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}/;
const MOBILE = /^(?:\+81[\s-]?)?0?[789]0/;

function cleanPhone(v: unknown) {
  const s = str(v, 30);
  if (!s) return null;
  const m = s.match(PHONE);
  return m ? m[0].replace(/[()]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-") : null;
}
function cleanPostal(v: unknown) {
  const m = String(v ?? "")
    .normalize("NFKC")
    .match(/(\d{3})-?(\d{4})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function sanitizeCard(raw: Partial<Record<keyof CardFields, unknown>>): CardFields {
  const email = str(raw.email, 120);
  return {
    company: str(raw.company, 100),
    department: str(raw.department, 100),
    title: str(raw.title, 60),
    name: str(raw.name, 60),
    email: email && EMAIL.test(email) ? email.match(EMAIL)![0].toLowerCase() : null,
    phone: cleanPhone(raw.phone),
    mobile: cleanPhone(raw.mobile),
    postalCode: cleanPostal(raw.postalCode),
    address: str(String(raw.address ?? "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, ""), 200),
    website: str(raw.website, 200),
  };
}

const LEGAL = /株式会社|有限会社|合同会社|合資会社|合名会社|社団法人|財団法人|特定非営利活動法人|NPO法人|医療法人|社会福祉法人|学校法人|税理士法人|弁護士法人|\(株\)|\(有\)|\(同\)|Co\.,?\s*Ltd|Inc\.|Corporation|K\.K\./i;
const TITLE = /代表取締役(?:社長)?|取締役(?:副社長)?|専務(?:取締役)?|常務(?:取締役)?|執行役員|社長|副社長|本部長|事業部長|部長代理|部長|次長|課長代理|課長|係長|主任|室長|店長|所長|支店長|工場長|マネージャー|マネジャー|リーダー|チーフ|ディレクター|プロデューサー|エンジニア|デザイナー|コンサルタント|担当/;
const DEPT = /本部|事業部|部|課|室|グループ|チーム|支店|支社|営業所|センター|工場|店$/;
const ADDRESS = /(?:都|道|府|県).*(?:市|区|郡|町|村)|^(?:東京都|北海道|大阪府|京都府|.{2,3}県)/;

// 名刺の文字(貼り付け・入力)から項目を見分ける(AIを使わない)
export function parseCardText(text: string): CardFields {
  const lines = text
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);
  const raw: Partial<Record<keyof CardFields, string>> = {};
  const rest: string[] = [];
  for (const line of lines) {
    let l = line;
    const email = l.match(EMAIL);
    if (email) {
      raw.email ??= email[0];
      l = l.replace(email[0], "").replace(/(?:E-?mail|メール|Mail)\s*[::]?/i, "").trim();
    }
    const url = l.match(/(?:https?:\/\/|www\.)\S+/i);
    if (url) {
      raw.website ??= url[0];
      l = l.replace(url[0], "").replace(/(?:URL|HP|Web)\s*[::]?/i, "").trim();
    }
    const postal = l.match(/〒\s*(\d{3}-?\d{4})|^(\d{3}-\d{4})(?![\d-])/);
    if (postal) {
      raw.postalCode ??= postal[1] ?? postal[2];
      l = l.replace(postal[0], "").trim();
      if (l && !raw.address) {
        raw.address = l;
        continue;
      }
    }
    // 電話・携帯・FAX(1行に並んでいることもある)
    if (PHONE.test(l) && /TEL|Tel|電話|携帯|Mobile|Mob|FAX|Fax|^[T M F]\s*[::.]|\d{2,4}-\d{2,4}-\d{3,4}/.test(l)) {
      const parts = l.split(/(?=(?:TEL|Tel|T|電話|携帯|Mobile|Mob|M|FAX|Fax|F)\s*[::.]?\s*(?:\+81|0)\d)/);
      for (const p of parts) {
        const num = p.match(PHONE)?.[0];
        if (!num) continue;
        if (/FAX|Fax|^F\s*[::.]/.test(p)) continue;
        if (/携帯|Mobile|Mob|^M\s*[::.]/.test(p) || MOBILE.test(num.replace(/[^\d+]/g, ""))) raw.mobile ??= num;
        else raw.phone ??= num;
      }
      continue;
    }
    if (!l) continue;
    if (!raw.address && ADDRESS.test(l) && /\d|丁目|番地/.test(l)) {
      raw.address = l;
      continue;
    }
    if (!raw.company && LEGAL.test(l)) {
      raw.company = l;
      continue;
    }
    const title = l.match(TITLE);
    if (title && l.length <= 30) {
      raw.title ??= title[0];
      const dept = l.replace(title[0], "").trim();
      // 「営業部 部長 山田太郎」のように氏名まで同じ行にあるとき
      const tokens = dept.split(" ");
      if (tokens.length > 1 && !DEPT.test(tokens[tokens.length - 1]) && /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]{1,5}$/u.test(tokens[tokens.length - 1])) {
        const nameTokens = tokens.splice(tokens.findIndex((t) => !DEPT.test(t)));
        raw.name ??= nameTokens.join(" ");
      }
      if (tokens.join(" ") && DEPT.test(tokens.join(" "))) raw.department ??= tokens.join(" ");
      else if (tokens.join(" ") && !raw.name) raw.name = tokens.join(" ");
      continue;
    }
    if (!raw.department && DEPT.test(l) && l.length <= 30 && !/^[\p{sc=Han}]{1,2} ?[\p{sc=Han}]{1,3}$/u.test(l)) {
      raw.department = l;
      continue;
    }
    rest.push(l);
  }
  // 残りから氏名(漢字・かな・カナの短い行)を選ぶ。ローマ字だけの行は読みなので使わない
  if (!raw.name) raw.name = rest.find((l) => /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]{1,6}(?: [\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]{1,6})?$/u.test(l)) ?? undefined;
  if (!raw.company) raw.company = rest.find((l) => l !== raw.name && !/^[A-Za-z .]+$/.test(l)) ?? undefined;
  return sanitizeCard(raw);
}

export type ReadResult = { cards: CardFields[]; mode: "claude" | "template"; note: string | null };

// 名刺の写真をAIで読み取る
export async function readCardImage(companyId: string, userId: string, file: File): Promise<ReadResult> {
  if (file.size > MAX_BYTES) throw new UserError("写真は1枚4MBまでです");
  const mediaType = file.type || "image/jpeg";
  if (!IMAGE_TYPES.includes(mediaType) && mediaType !== "application/pdf") throw new UserError("写真(JPEG・PNG・WebP)かPDFを選んでください");
  const client = await aiFor(companyId);
  if (!client) return { cards: [], mode: "template", note: "AIが使えないため写真は読み取れません。名刺の文字を下に貼り付けるか、入力してください。" };
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) return { cards: [], mode: "template", note: "今日のAIの利用回数の上限に達しました。名刺の文字を下に貼り付けるか、入力してください。" };
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const media: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: base64 } };
  let result: ReadResult = { cards: [], mode: "template", note: "読み取れませんでした。写真を撮り直すか、名刺の文字を下に貼り付けてください。" };
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: [
            "あなたは会社の総務担当として、受け取った名刺を住所録に登録するために読み取ります。",
            "写っている名刺ごとに、書かれていることだけをそのまま読み取ってください。読めない・書かれていない項目は null にし、推測で埋めないでください。",
            "名刺の表と裏(英語面)が両方写っているときは、日本語の面を優先して1枚として扱ってください。FAX番号は phone に入れないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: [media, { type: "text", text: "この写真の名刺を読み取ってください。" }] }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const parsed = JSON.parse(text) as { cards?: unknown };
      const cards = (Array.isArray(parsed.cards) ? parsed.cards : [])
        .slice(0, MAX_CARDS)
        .map((c) => sanitizeCard((c ?? {}) as Partial<Record<keyof CardFields, unknown>>))
        .filter((c) => c.company || c.name);
      result = cards.length ? { cards, mode: "claude", note: null } : { cards: [], mode: "claude", note: "名刺が見つかりませんでした。名刺全体が写るように撮り直してください。" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId, userId, question: `名刺の読み取り ${file.name}`.slice(0, 200), tools: [], mode: `card-${result.mode}` } });
  return result;
}

// もう登録されている相手(会社名が同じ・含む、メールが同じ、会社名のない名刺は氏名が同じ)
export async function findCardMatches(companyId: string, card: CardFields): Promise<CardMatch[]> {
  const key = card.company ? normalizeName(card.company) : "";
  const personKey = card.name ? normalizeName(card.name) : "";
  const domain = card.email?.split("@")[1] ?? null;
  const freeMail = domain ? /^(gmail|yahoo|icloud|outlook|hotmail|docomo|ezweb|softbank|i\.softbank|au|me|live|msn|aol)\./.test(domain) : true;
  const [customers, vendors] = await Promise.all([
    prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true, email: true, contactName: true, phone: true, address: true } }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true, contactName: true, phone: true, address: true } }),
  ]);
  const out: (CardMatch & { score: number })[] = [];
  const check = (kind: PartyKind, p: { id: string; name: string; email?: string | null; contactName: string | null; phone: string | null; address: string | null }) => {
    const n = normalizeName(p.name);
    let reason = "";
    let score = 0;
    if (key && n === key) [reason, score] = ["会社名が同じ", 3];
    else if (!key && personKey && n === personKey) [reason, score] = ["名前が同じ", 3];
    else if (card.email && p.email && p.email.toLowerCase() === card.email) [reason, score] = ["メールアドレスが同じ", 3];
    else if (key.length >= 3 && n.length >= 3 && (n.includes(key) || key.includes(n))) [reason, score] = ["会社名が似ている", 2];
    else if (domain && !freeMail && p.email?.toLowerCase().endsWith(`@${domain}`)) [reason, score] = ["メールのドメインが同じ", 1];
    else if (card.phone && p.phone && p.phone.replace(/\D/g, "") === card.phone.replace(/\D/g, "")) [reason, score] = ["電話番号が同じ", 2];
    if (score) out.push({ kind, id: p.id, name: p.name, reason, contactName: p.contactName, email: p.email ?? null, phone: p.phone, address: p.address, score });
  };
  customers.forEach((c) => check("customer", c));
  vendors.forEach((v) => check("vendor", v));
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((m) => ({ kind: m.kind, id: m.id, name: m.name, reason: m.reason, contactName: m.contactName, email: m.email, phone: m.phone, address: m.address }));
}

type RegisterInput = { kind: PartyKind; card: CardFields; targetId: string | null; overwrite: boolean };

// 住所録の項目に写す(電話は会社の電話がなければ携帯)
function partyData(card: CardFields) {
  return {
    department: card.department,
    contactName: card.company ? card.name : null,
    honorific: card.company && card.name ? "様" : card.company ? "御中" : "様",
    phone: card.phone ?? card.mobile,
    postalCode: card.postalCode,
    address: card.address,
  };
}

const LABEL: Record<string, string> = { department: "部署", contactName: "担当者", honorific: "敬称", phone: "電話", postalCode: "郵便番号", address: "住所", email: "メール" };

export async function registerCard(companyId: string, input: RegisterInput) {
  const card = sanitizeCard(input.card);
  const name = card.company ?? card.name;
  if (!name) throw new UserError("会社名か氏名を入れてください");
  const base = partyData(card);
  const data: Record<string, string | null> = input.kind === "customer" ? { ...base, email: card.email } : base;
  if (!input.targetId) {
    const created =
      input.kind === "customer"
        ? await prisma.customer.create({ data: { companyId, name, ...base, email: card.email } })
        : await prisma.vendor.create({ data: { companyId, name, ...base } });
    return { id: created.id, name: created.name, created: true, filled: Object.keys(data).filter((k) => data[k] && k !== "honorific").map((k) => LABEL[k]), differs: [] as string[] };
  }
  const existing: Record<string, unknown> | null =
    input.kind === "customer"
      ? await prisma.customer.findFirst({ where: { id: input.targetId, companyId } })
      : await prisma.vendor.findFirst({ where: { id: input.targetId, companyId } });
  if (!existing) throw new UserError("登録先の取引先が見つかりません");
  const update: Record<string, string> = {};
  const filled: string[] = [];
  const differs: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (!v || k === "honorific") continue;
    const cur = existing[k] as string | null;
    if (!cur) {
      update[k] = v;
      filled.push(LABEL[k]);
    } else if (cur.normalize("NFKC").replace(/\s/g, "") !== v.replace(/\s/g, "")) {
      if (input.overwrite) {
        update[k] = v;
        filled.push(LABEL[k]);
      } else differs.push(LABEL[k]);
    }
  }
  // 担当者を入れたら敬称は「様」に
  if (update.contactName) update.honorific = "様";
  if (Object.keys(update).length) {
    if (input.kind === "customer") await prisma.customer.update({ where: { id: input.targetId }, data: update });
    else await prisma.vendor.update({ where: { id: input.targetId }, data: update });
  }
  return { id: input.targetId, name: String(existing.name), created: false, filled, differs };
}

export function parseRegisterInput(body: unknown): RegisterInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind === "vendor" ? "vendor" : b.kind === "customer" ? "customer" : null;
  if (!kind) throw new UserError("顧客か仕入先かを選んでください");
  const card = sanitizeCard((b.card ?? {}) as Partial<Record<keyof CardFields, unknown>>);
  const targetId = typeof b.targetId === "string" && b.targetId ? b.targetId : null;
  return { kind, card, targetId, overwrite: b.overwrite === true };
}
