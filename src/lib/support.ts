import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { normalizeEmail, sendMail } from "@/lib/mail";
import { operatorEmails } from "@/lib/operator";

// お問い合わせ(サポートページのフォーム)と、運営からのお知らせ

export const CATEGORIES = {
  USAGE: "使い方",
  BILLING: "料金・契約",
  BUG: "不具合・エラー",
  ACCOUNT: "アカウント・ログイン",
  DELETE: "アカウント・データの削除",
  OTHER: "その他",
} as const;

const text = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

// 運営者のメールの送り元にする会社(運営者のアカウントの会社)
async function operatorCompanyId() {
  const emails = operatorEmails();
  if (!emails.length) return null;
  const user = await prisma.user.findFirst({ where: { email: { in: emails } }, select: { companyId: true } });
  return user?.companyId ?? null;
}

type TicketInput = { name?: unknown; email?: unknown; category?: unknown; subject?: unknown; body?: unknown; website?: unknown };

export async function createTicket(input: TicketInput, user?: { id: string; companyId: string } | null) {
  // ロボットよけ: 画面に見えない欄に何か入っていたら、受け付けたふりをして保存しない
  if (text(input.website, 200)) return null;
  const name = text(input.name, 60);
  if (!name) throw new UserError("お名前を入力してください");
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    throw new UserError("返信先のメールアドレスを正しく入力してください");
  }
  const category = String(input.category ?? "OTHER");
  if (!(category in CATEGORIES)) throw new UserError("お問い合わせの種類を選んでください");
  const subject = text(input.subject, 100).replace(/\n/g, " ");
  if (!subject) throw new UserError("件名を入力してください");
  const body = text(input.body, 5000);
  if (body.length < 10) throw new UserError("お問い合わせの内容を10文字以上で入力してください");
  const hourAgo = new Date(Date.now() - 3_600_000);
  if ((await prisma.supportTicket.count({ where: { email, createdAt: { gte: hourAgo } } })) >= 5 || (await prisma.supportTicket.count({ where: { createdAt: { gte: hourAgo } } })) >= 100) {
    throw new UserError("お問い合わせが続いています。しばらくしてからもう一度お送りください");
  }
  const ticket = await prisma.supportTicket.create({ data: { name, email, category, subject, body, companyId: user?.companyId ?? null, userId: user?.id ?? null } });

  // 運営者にメールで知らせる(送れなくても、お問い合わせは運営者メニューに残る)
  const companyId = await operatorCompanyId();
  if (companyId) {
    const company = user ? await prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true } }) : null;
    for (const to of operatorEmails()) {
      await sendMail({
        companyId,
        kind: "SUPPORT",
        to,
        subject: `【お問い合わせ】${CATEGORIES[category as keyof typeof CATEGORIES]}: ${subject}`,
        text: [`${name} 様(${email})${company ? ` / ${company.name}` : ""}`, "", body, "", "運営者メニュー →「お問い合わせ」から返信できます。"].join("\n"),
        sentByName: "システム",
        relatedId: ticket.id,
      }).catch((e) => console.error("support notify failed", e));
    }
  }
  return ticket;
}

export async function listTickets(status: "OPEN" | "CLOSED" | "ALL" = "OPEN") {
  const tickets = await prisma.supportTicket.findMany({ where: status === "ALL" ? {} : { status }, orderBy: { createdAt: "desc" }, take: 200 });
  const companies = await prisma.company.findMany({ where: { id: { in: tickets.map((t) => t.companyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  return tickets.map((t) => ({ ...t, companyName: t.companyId ? (nameOf.get(t.companyId) ?? null) : null }));
}

export async function countOpenTickets() {
  return prisma.supportTicket.count({ where: { status: "OPEN" } });
}

// 返信する(メールで送って、対応済みにする)・対応済みにする・未対応に戻す
export async function updateTicket(id: string, input: { action?: unknown; reply?: unknown }, operator: { name: string }) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new UserError("お問い合わせが見つかりません");
  if (input.action === "close" || input.action === "reopen") {
    return prisma.supportTicket.update({ where: { id }, data: { status: input.action === "close" ? "CLOSED" : "OPEN" } });
  }
  if (input.action !== "reply") throw new UserError("操作が正しくありません");
  const reply = text(input.reply, 10_000);
  if (reply.length < 2) throw new UserError("返信の内容を入力してください");
  const companyId = await operatorCompanyId();
  if (!companyId) throw new UserError("運営者のアカウントが見つかりません(OPERATOR_EMAILS を確かめてください)");
  const log = await sendMail({
    companyId,
    kind: "SUPPORT",
    to: ticket.email,
    subject: `Re: ${ticket.subject}`,
    text: [`${ticket.name} 様`, "", reply, "", "――――――――――――", "お問い合わせ内容:", ticket.body].join("\n"),
    sentByName: operator.name,
    relatedId: ticket.id,
  });
  if (log.status === "FAILED") throw new UserError(`メールを送れませんでした(${log.error ?? "原因不明"})`);
  return prisma.supportTicket.update({ where: { id }, data: { reply, repliedAt: new Date(), status: "CLOSED" } });
}

// ---- 運営からのお知らせ

export async function activeNotices(now = new Date()) {
  return prisma.serviceNotice.findMany({
    where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    orderBy: { startsAt: "desc" },
    take: 3,
    select: { id: true, title: true, body: true, level: true },
  });
}

export async function listNotices() {
  return prisma.serviceNotice.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
}

export async function createNotice(input: { title?: unknown; body?: unknown; level?: unknown; endsAt?: unknown }) {
  const title = text(input.title, 100).replace(/\n/g, " ");
  if (!title) throw new UserError("お知らせの見出しを入力してください");
  const body = text(input.body, 1000) || null;
  const level = input.level === "warning" ? "warning" : "info";
  const end = String(input.endsAt ?? "").trim();
  let endsAt: Date | null = null;
  if (end) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)) throw new UserError("表示を終える日時を正しく入力してください");
    endsAt = new Date(`${end}:00+09:00`);
    if (endsAt <= new Date()) throw new UserError("表示を終える日時は、これから先の日時にしてください");
  }
  return prisma.serviceNotice.create({ data: { title, body, level, endsAt } });
}

// 表示を終える(記録は残す)
export async function endNotice(id: string) {
  const notice = await prisma.serviceNotice.findUnique({ where: { id } });
  if (!notice) throw new UserError("お知らせが見つかりません");
  return prisma.serviceNotice.update({ where: { id }, data: { endsAt: new Date() } });
}
