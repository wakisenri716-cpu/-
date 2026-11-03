import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { MailError, appUrl, sendMail } from "@/lib/mail";

// 押印の申請と押印簿: 従業員が「さくら商事との業務委託契約書 2部 実印」のように1行で頼み、管理者が認めて押し、押印簿に残す。
// 実印・銀行印は、頼んだ本人が自分で認めることはできない(管理者がひとりのときは、押印簿に「自分で認めた」と残す)。

export const SEALS = { JITSUIN: "実印(代表者印)", BANK: "銀行印", KAKUIN: "角印(社印)", OTHER: "そのほかの印" } as const;
export type Seal = keyof typeof SEALS;
export const STATUS = { REQUESTED: "申請中", APPROVED: "認めた(押す前)", REJECTED: "見送り", DONE: "押した" } as const;
type Me = { id: string; name: string; companyId: string; role: string };
const canManage = (role: string) => role === "ADMIN";
const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const STRICT: Seal[] = ["JITSUIN", "BANK"];

export function sealOf(text: string): Seal | null {
  if (/実印|代表者印|代表印|丸印/.test(text)) return "JITSUIN";
  if (/銀行印|届出印/.test(text)) return "BANK";
  if (/角印|社印|会社印/.test(text)) return "KAKUIN";
  return null;
}

export type SealDraft = { seal: Seal; document: string; party: string | null; copies: number; purpose: string | null };

// 1行を分ける(何も保存しない)。印の種類がなければ、契約書・委任状なら実印、請求書・見積書なら角印とみる
export function templateSeal(line: string): SealDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const copiesM = t.match(/(\d{1,3})\s*(部|通|枚|冊)/);
  const party = t.match(/([^\s、。]{2,25}?)(?:様|さま|さん)?(?:との|宛ての?|あての?|向けの?|に出す|へ出す|へ提出する?)/)?.[1] ?? null;
  const docM = t.match(/[^\s、。のと]*?(契約書|覚書|合意書|念書|委任状|申請書|申込書|届出書?|請求書|見積書|発注書|注文書|納品書|領収書|誓約書|証明書|稟議書|議事録|登記[^\s]*|[^\s、。]*書類)/);
  let seal = sealOf(t);
  const doc = docM?.[0] ?? null;
  if (!seal) seal = doc && /契約書|覚書|合意書|委任状|登記|念書/.test(doc) ? "JITSUIN" : doc && /請求書|見積書|発注書|注文書|納品書|領収書/.test(doc) ? "KAKUIN" : "OTHER";
  let rest = t;
  for (const s of [copiesM?.[0], party ? t.match(new RegExp(`${party.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:様|さま|さん)?(?:との|宛ての?|あての?|向けの?|に出す|へ出す|へ提出する?)`))?.[0] : null]) if (s) rest = rest.replace(s, " ");
  rest = rest.replace(/実印|代表者印|代表印|丸印|銀行印|届出印|角印|社印|会社印|を押して(ほしい|ください)?|押印(を)?(お願い(します)?|したい)?|お願いします|を?押したい/g, " ").replace(/\s+/g, " ").replace(/^[\s、。のをに]+|[\s、。のをに]+$/g, "").trim();
  return { seal, document: (rest || doc || "書類").slice(0, 80), party: party ? party.slice(0, 40) : null, copies: copiesM ? Math.min(Number(copiesM[1]), 999) : 1, purpose: null };
}

export async function parseSeal(text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("押したい書類を書いてください(例: さくら商事との業務委託契約書 2部 実印)");
  return templateSeal(t);
}

async function admins(companyId: string) {
  const rows = await prisma.companyMember.findMany({ where: { companyId, active: true, role: "ADMIN" }, include: { user: { select: { id: true, name: true, email: true, active: true } } } });
  return rows.filter((m) => m.user.active).map((m) => m.user);
}

// 従業員・管理者が頼む。管理者にメールで知らせる
export async function requestSeal(me: { id: string; name: string; companyId: string }, raw: Record<string, unknown>, request?: Request) {
  const seal: Seal = typeof raw.seal === "string" && raw.seal in SEALS ? (raw.seal as Seal) : "OTHER";
  const document = oneLine(raw.document, 80);
  if (!document) throw new UserError("書類の名前を入れてください");
  const copies = Number(raw.copies ?? 1);
  if (!Number.isInteger(copies) || copies < 1 || copies > 999) throw new UserError("部数を正しく入れてください");
  const row = await prisma.sealUse.create({ data: { companyId: me.companyId, seal, document, party: oneLine(raw.party, 40) || null, copies, purpose: oneLine(raw.purpose, 200) || null, requestedById: me.id, requestedByName: me.name } });
  for (const a of (await admins(me.companyId)).filter((x) => x.id !== me.id && x.email)) {
    try {
      await sendMail({ companyId: me.companyId, kind: "NOTICE", to: a.email, subject: `【押印の申請】${SEALS[seal]}: ${document}`, text: `${a.name}さん\n\n${me.name}さんから押印の申請が届きました。\n\n・印: ${SEALS[seal]}\n・書類: ${document}${row.party ? `(${row.party})` : ""} ${copies}部${row.purpose ? `\n・使いみち: ${row.purpose}` : ""}\n\n押印簿: ${appUrl(request)}/seals\n`, sentByName: me.name, relatedId: row.id });
    } catch (error) {
      if (!(error instanceof MailError)) throw error;
    }
  }
  return row;
}

// 管理者: 認める・見送る・押した(認めずに押したものを押印簿にそのまま記録するのも「押した」)
export async function decideSeal(me: Me, id: string, raw: Record<string, unknown>, request?: Request) {
  if (!canManage(me.role)) throw new UserError("押印を認めるのは管理者です");
  const row = await prisma.sealUse.findFirst({ where: { id, companyId: me.companyId } });
  if (!row) throw new UserError("見つかりません");
  const action = String(raw.action ?? "");
  const own = row.requestedById === me.id;
  if ((action === "approve" || action === "done") && own && STRICT.includes(row.seal as Seal) && row.status === "REQUESTED") {
    const others = (await admins(me.companyId)).filter((a) => a.id !== me.id);
    if (others.length) throw new UserError(`${SEALS[row.seal as Seal]}は、頼んだ本人は認められません。ほかの管理者(${others.map((a) => a.name).join("・")})に認めてもらってください`);
  }
  let data: Record<string, unknown>;
  if (action === "approve") {
    if (row.status !== "REQUESTED") throw new UserError("申請中のものだけ認められます");
    data = { status: "APPROVED", decidedByName: own ? `${me.name}(自分で認めた)` : me.name };
  } else if (action === "reject") {
    if (row.status !== "REQUESTED" && row.status !== "APPROVED") throw new UserError("押したものは見送りにできません");
    const reply = oneLine(raw.reply, 200);
    if (!reply) throw new UserError("見送る理由を書いてください");
    data = { status: "REJECTED", decidedByName: me.name, reply };
  } else if (action === "done") {
    if (row.status === "REJECTED" || row.status === "DONE") throw new UserError("この申請は押せません");
    const doneOn = String(raw.doneOn ?? "") || jstDateKey(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn) || doneOn > jstDateKey(new Date())) throw new UserError("押した日を正しく入れてください");
    data = { status: "DONE", doneOn, pressedByName: me.name, decidedByName: row.decidedByName ?? (own ? `${me.name}(自分で認めた)` : me.name) };
  } else throw new UserError("することがわかりません");
  const updated = await prisma.sealUse.update({ where: { id }, data });
  // 頼んだ人に知らせる
  if (!own && (action === "reject" || action === "done")) {
    const u = await prisma.user.findFirst({ where: { id: row.requestedById, active: true }, select: { email: true } });
    if (u?.email) {
      try {
        await sendMail({ companyId: me.companyId, kind: "NOTICE", to: u.email, subject: action === "done" ? `【押印】${row.document}に押しました` : `【押印】${row.document}は見送りになりました`, text: `${row.requestedByName}さん\n\n申請した「${row.document}」(${SEALS[row.seal as Seal]})は${action === "done" ? "押しました。受け取ってください" : `見送りになりました(${updated.reply})`}。\n\n押印の申請: ${appUrl(request)}/staff/seals\n`, sentByName: me.name, relatedId: row.id });
      } catch (error) {
        if (!(error instanceof MailError)) throw error;
      }
    }
  }
  return updated;
}

// 押印簿(この1年)と申請中
export async function listSeals(companyId: string) {
  const since = new Date(Date.now() - 365 * 86_400_000);
  const rows = await prisma.sealUse.findMany({ where: { companyId, OR: [{ status: { in: ["REQUESTED", "APPROVED"] } }, { createdAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 500 });
  return { pending: rows.filter((r) => r.status === "REQUESTED" || r.status === "APPROVED").reverse(), log: rows.filter((r) => r.status === "DONE" || r.status === "REJECTED") };
}

export async function mySeals(me: { id: string; companyId: string }) {
  return prisma.sealUse.findMany({ where: { companyId: me.companyId, requestedById: me.id }, orderBy: { createdAt: "desc" }, take: 30 });
}

export async function countSealRequests(companyId: string) {
  return prisma.sealUse.count({ where: { companyId, status: { in: ["REQUESTED", "APPROVED"] } } });
}
