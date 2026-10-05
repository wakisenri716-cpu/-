import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { createFolder, MAX_FILE_BYTES, saveFile, sniffType } from "@/lib/files";

// 契約書の台帳: 契約書(PDF・画像)からAIが相手・期間・自動更新・解約の申し出期限・金額・気をつける条項を読み取り、一覧にする。
// 解約の申し出期限(満了日の何日前まで)が近づいたら、書類の期限のお知らせ(ダッシュボード・カレンダー)で知らせる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const FOLDER = "契約書";

export const CONTRACT_KINDS: Record<string, string> = {
  OUTSOURCING: "業務委託",
  LEASE: "賃貸借・リース",
  SERVICE: "保守・サービス",
  SALES: "売買・取引基本",
  NDA: "秘密保持",
  EMPLOYMENT: "雇用",
  OTHER: "その他",
};
const PERIODS = ["MONTHLY", "YEARLY", "ONCE"];

type Actor = { id: string; name: string; companyId: string };
export type ContractFields = {
  title: string;
  counterparty: string | null;
  kind: string;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  noticeDays: number | null;
  amount: number | null;
  amountPeriod: string | null;
  paymentTerms: string | null;
  keyPoints: string[];
  summary: string | null;
};

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "契約の名前(例: 業務委託契約書)" },
    counterparty: { type: ["string", "null"], description: "相手の会社・人の名前" },
    kind: { type: "string", enum: Object.keys(CONTRACT_KINDS) },
    startDate: { type: ["string", "null"], description: "契約の開始日 YYYY-MM-DD" },
    endDate: { type: ["string", "null"], description: "契約の満了日 YYYY-MM-DD" },
    autoRenew: { type: "boolean", description: "申し出がなければ自動で更新されるか" },
    renewalMonths: { type: ["integer", "null"], description: "自動更新の期間(か月)。1年なら12" },
    noticeDays: { type: ["integer", "null"], description: "解約・更新しない旨を満了日の何日前までに申し出るか。1か月前なら30、3か月前なら90" },
    amount: { type: ["integer", "null"], description: "契約の金額(税込・円)" },
    amountPeriod: { type: ["string", "null"], enum: [...PERIODS, null], description: "金額が月額・年額・一回かぎりか" },
    paymentTerms: { type: ["string", "null"], description: "支払条件(例: 月末締め翌月末払い)" },
    keyPoints: { type: "array", items: { type: "string" }, description: "気をつける条項(中途解約・違約金・損害賠償・競業避止・再委託など)を最大5つ、短く" },
    summary: { type: "string", description: "1〜2文の要約" },
  },
  required: ["title", "counterparty", "kind", "startDate", "endDate", "autoRenew", "renewalMonths", "noticeDays", "amount", "amountPeriod", "paymentTerms", "keyPoints", "summary"],
  additionalProperties: false,
} as const;

const str = (v: unknown, max: number) => {
  const s = String(v ?? "").normalize("NFKC").trim().slice(0, max);
  return s || null;
};
const date = (v: unknown) => (DATE.test(String(v ?? "")) && !Number.isNaN(Date.parse(String(v))) ? String(v) : null);
const int = (v: unknown, min: number, max: number) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// 読み取った値・入力された値を確かめて整える
export function sanitizeContract(raw: Record<string, unknown>): ContractFields {
  const startDate = date(raw.startDate);
  let endDate = date(raw.endDate);
  if (startDate && endDate && endDate < startDate) endDate = null;
  return {
    title: str(raw.title, 80) ?? "契約書",
    counterparty: str(raw.counterparty, 80),
    kind: CONTRACT_KINDS[String(raw.kind)] ? String(raw.kind) : "OTHER",
    startDate,
    endDate,
    autoRenew: raw.autoRenew === true || raw.autoRenew === "true",
    renewalMonths: int(raw.renewalMonths, 1, 120),
    noticeDays: int(raw.noticeDays, 0, 730),
    amount: int(raw.amount, 0, 10_000_000_000),
    amountPeriod: PERIODS.includes(String(raw.amountPeriod)) ? String(raw.amountPeriod) : null,
    paymentTerms: str(raw.paymentTerms, 100),
    keyPoints: (Array.isArray(raw.keyPoints) ? raw.keyPoints : []).map((k) => str(k, 120)).filter((k): k is string => !!k).slice(0, 5),
    summary: str(raw.summary, 300),
  };
}

// APIキーがないとき: ファイル名から種類と名前だけ決める
export function templateContract(fileName: string): ContractFields {
  const name = fileName.replace(/\.[a-z0-9]+$/i, "");
  const kind = /業務委託|委託/.test(name) ? "OUTSOURCING" : /賃貸|リース/.test(name) ? "LEASE" : /保守|サービス|利用/.test(name) ? "SERVICE" : /秘密保持|NDA/i.test(name) ? "NDA" : /売買|取引基本/.test(name) ? "SALES" : /雇用/.test(name) ? "EMPLOYMENT" : "OTHER";
  return sanitizeContract({ title: name || "契約書", kind, keyPoints: [], summary: "AIのキーが設定されていないため、内容は読み取っていません。期間・金額を入力してください。" });
}

async function analyze(companyId: string, userId: string, base64: string, mediaType: string, fileName: string): Promise<{ fields: ContractFields; mode: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { fields: templateContract(fileName), mode: "template" };
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) return { fields: templateContract(fileName), mode: "template" };
  const media: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: base64 } };
  let result: { fields: ContractFields; mode: string } = { fields: templateContract(fileName), mode: "template" };
  try {
    const response = await new Anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: [
            "あなたは会社の総務担当として、契約書を台帳に登録するために読み取ります。書かれていることだけを読み取り、書かれていない項目は null にしてください。",
            "自動更新の条項(「期間満了の○か月前までに申し出がないときは、同一条件で1年間更新」など)があれば autoRenew を true にし、renewalMonths と noticeDays を入れてください。",
            "keyPoints には、会社が損をしないよう気をつける条項(中途解約の条件・違約金・損害賠償の上限・競業避止・再委託の禁止・著作権の帰属など)を短く書いてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: [media, { type: "text", text: `ファイル名: ${fileName}\nこの契約書を読み取ってください。` }] }],
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
      result = { fields: sanitizeContract(JSON.parse(text)), mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId, userId, question: `契約書の読み取り ${fileName}`, tools: [], mode: `contract-${result.mode}` } });
  return result;
}

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

// 次の満了日(自動更新なら、過ぎた満了日を更新期間ずつ先へ送る)と、解約の申し出期限
export function contractDates(c: { endDate: Date | null; autoRenew: boolean; renewalMonths: number | null; noticeDays: number | null }, today = jstDateKey(new Date())) {
  if (!c.endDate) return { nextEnd: null as string | null, deadline: null as string | null };
  const deadlineOf = (end: string) => (c.noticeDays !== null ? new Date(Date.parse(`${end}T00:00:00Z`) - c.noticeDays * DAY).toISOString().slice(0, 10) : null);
  let end = jstDateKey(c.endDate);
  if (c.autoRenew) {
    // 申し出期限を過ぎたら今の期間は更新が決まっているので、次に判断できる期間の満了日まで送る
    const months = c.renewalMonths ?? 12;
    for (let i = 0; i < 100 && (deadlineOf(end) ?? end) < today; i++) {
      const d = new Date(`${end}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + months);
      end = d.toISOString().slice(0, 10);
    }
  }
  return { nextEnd: end, deadline: deadlineOf(end) };
}

// 書類の期限のお知らせに使う日(解約の申し出期限があればそちら)
async function syncFileExpiry(companyId: string, contract: { fileId: string | null; endDate: Date | null; autoRenew: boolean; renewalMonths: number | null; noticeDays: number | null; status: string }) {
  if (!contract.fileId) return;
  const { nextEnd, deadline } = contractDates(contract);
  const when = contract.status === "ACTIVE" ? (deadline ?? nextEnd) : null;
  await prisma.storedFile.updateMany({ where: { id: contract.fileId, companyId }, data: { expiresOn: when ? new Date(`${when}T00:00:00Z`) : null } });
}

export async function createContractFromFile(user: Actor, fileId: string) {
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, companyId: user.companyId }, select: { id: true, name: true, mimeType: true, data: true } });
  if (!file) throw new UserError("ファイルが見つかりません");
  const existing = await prisma.contract.findFirst({ where: { companyId: user.companyId, fileId } });
  if (existing) return existing;
  const { fields, mode } = await analyze(user.companyId, user.id, Buffer.from(file.data).toString("base64"), file.mimeType, file.name);
  const contract = await prisma.contract.create({
    data: { companyId: user.companyId, fileId, ...fields, startDate: toDate(fields.startDate), endDate: toDate(fields.endDate), mode, createdBy: user.name },
  });
  await syncFileExpiry(user.companyId, contract);
  return contract;
}

// 契約書をアップロードして台帳に登録する(書類フォルダ「契約書」に保存)
export async function uploadContract(user: Actor, file: File) {
  if (file.size === 0) throw new UserError("空のファイルです");
  if (file.size > MAX_FILE_BYTES) throw new UserError("ファイルが大きすぎます(4MBまで)");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(type)) throw new UserError("PDFか画像を選んでください");
  const folder = (await prisma.folder.findFirst({ where: { companyId: user.companyId, name: FOLDER, parentId: null } })) ?? (await createFolder(user.companyId, { name: FOLDER }));
  const saved = await saveFile(user.companyId, { file, folderId: folder.id, uploadedByName: user.name });
  return createContractFromFile(user, saved.id);
}

export async function updateContract(companyId: string, id: string, input: Record<string, unknown>) {
  const contract = await prisma.contract.findFirst({ where: { id, companyId } });
  if (!contract) throw new UserError("契約が見つかりません");
  if (input.status === "ENDED" || input.status === "ACTIVE") {
    const updated = await prisma.contract.update({ where: { id }, data: { status: input.status } });
    await syncFileExpiry(companyId, updated);
    return updated;
  }
  const f = sanitizeContract(input);
  if (!str(input.title, 80)) throw new UserError("契約の名前を入れてください");
  const updated = await prisma.contract.update({ where: { id }, data: { ...f, startDate: toDate(f.startDate), endDate: toDate(f.endDate) } });
  await syncFileExpiry(companyId, updated);
  return updated;
}

export async function deleteContract(companyId: string, id: string) {
  const contract = await prisma.contract.findFirst({ where: { id, companyId } });
  if (!contract) throw new UserError("契約が見つかりません");
  await prisma.contract.delete({ where: { id } });
  return contract;
}

export async function listContracts(companyId: string, today = jstDateKey(new Date())) {
  const rows = await prisma.contract.findMany({ where: { companyId }, orderBy: [{ status: "asc" }, { endDate: "asc" }] });
  const files = new Map((await prisma.storedFile.findMany({ where: { companyId, id: { in: rows.flatMap((r) => (r.fileId ? [r.fileId] : [])) } }, select: { id: true, folderId: true, name: true } })).map((f) => [f.id, f]));
  const list = rows.map((r) => {
    const { nextEnd, deadline } = contractDates(r, today);
    const days = (d: string | null) => (d ? Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY) : null);
    const monthly = r.amount === null ? null : r.amountPeriod === "MONTHLY" ? r.amount : r.amountPeriod === "YEARLY" ? Math.round(r.amount / 12) : null;
    const file = r.fileId ? files.get(r.fileId) : null;
    return {
      ...r,
      startDate: r.startDate ? jstDateKey(r.startDate) : null,
      endDate: r.endDate ? jstDateKey(r.endDate) : null,
      keyPoints: (Array.isArray(r.keyPoints) ? r.keyPoints : []) as string[],
      nextEnd,
      deadline,
      daysToDeadline: days(deadline),
      daysToEnd: days(nextEnd),
      monthly,
      file: file ? { id: file.id, name: file.name, href: `/api/files/${file.id}` } : null,
    };
  });
  const active = list.filter((c) => c.status === "ACTIVE");
  return {
    contracts: list,
    monthlyTotal: active.reduce((s, c) => s + (c.monthly ?? 0), 0),
    soon: active.filter((c) => (c.daysToDeadline ?? c.daysToEnd ?? 999) <= 60 && (c.daysToDeadline ?? c.daysToEnd ?? -1) >= 0).length,
  };
}
