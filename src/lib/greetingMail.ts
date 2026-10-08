import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { addressee } from "@/lib/addressBook";
import { MailError, sendMail } from "@/lib/mail";
import { greetingMailText } from "@/lib/greetingMailText";

// 挨拶状・お知らせをメールでまとめて送る: 作った挨拶状(年末年始の休業・移転・担当者の交代など)を、
// メールアドレスのある顧客に1社ずつ宛名を入れて送る(BCCの一斉送信はしない)。同じ件名を24時間以内に送った相手には送らない。

const MAX_RECIPIENTS = 100;
const MAIL_DAILY_LIMIT = 200; // mail.ts の1日の上限と同じ

export async function mailRecipients(companyId: string) {
  const rows = await prisma.customer.findMany({
    where: { companyId, email: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      contactName: true,
      honorific: true,
    },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => r.email && r.email.includes("@"));
}

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);

export async function sendGreetingMails(
  user: { companyId: string; name: string },
  raw: Record<string, unknown>,
) {
  const subject = clean(raw.subject, 120).replace(/\n/g, " ");
  if (!subject) throw new UserError("件名を入れてください");
  const body = (Array.isArray(raw.body) ? raw.body : [])
    .map((p) => clean(p, 600))
    .filter(Boolean)
    .slice(0, 10);
  if (!body.length)
    throw new UserError("本文がありません。先に挨拶状を作ってください");
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map((n) => clean(n, 200).replace(/\n/g, " "))
    .filter(Boolean)
    .slice(0, 10);
  const ids = [
    ...new Set(
      (Array.isArray(raw.recipients) ? raw.recipients : []).filter(
        (x): x is string => typeof x === "string",
      ),
    ),
  ];
  if (!ids.length) throw new UserError("送る相手を選んでください");
  if (ids.length > MAX_RECIPIENTS)
    throw new UserError(`一度に送れるのは${MAX_RECIPIENTS}社までです`);

  const [company, all] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { name: true, phone: true, address: true, representative: true },
    }),
    mailRecipients(user.companyId),
  ]);
  const targets = all.filter((c) => ids.includes(c.id));
  if (!targets.length)
    throw new UserError("メールアドレスのある顧客が選ばれていません");

  // 二度押し・送り直しで同じお知らせが重ならないように
  const since = new Date(Date.now() - 86_400_000);
  const already = new Set(
    (
      await prisma.emailLog.findMany({
        where: {
          companyId: user.companyId,
          kind: "LETTER",
          subject,
          status: { not: "FAILED" },
          createdAt: { gte: since },
        },
        select: { to: true },
      })
    ).map((l) => l.to.toLowerCase()),
  );
  const fresh = targets.filter((t) => !already.has(t.email!.toLowerCase()));
  const sentToday = await prisma.emailLog.count({
    where: {
      companyId: user.companyId,
      createdAt: { gte: since },
      status: { not: "FAILED" },
    },
  });
  if (fresh.length > MAIL_DAILY_LIMIT - sentToday)
    throw new UserError(
      `今日はあと${Math.max(0, MAIL_DAILY_LIMIT - sentToday)}通までしか送れません(1日${MAIL_DAILY_LIMIT}通まで)。相手を減らすか、明日送ってください`,
    );

  const sender =
    clean(raw.sender, 60).replace(/\n/g, " ") ||
    company.representative ||
    user.name;
  const me = {
    company: company.name,
    sender,
    phone: company.phone,
    address: company.address,
  };
  let sent = 0;
  let test = 0;
  const failed: string[] = [];
  let stopped = false;
  for (const t of fresh) {
    try {
      const log = await sendMail({
        companyId: user.companyId,
        kind: "LETTER",
        to: t.email!,
        subject,
        text: greetingMailText(addressee(t), { body, notes }, me),
        sentByName: user.name,
        relatedId: t.id,
      });
      if (log.status === "FAILED") failed.push(t.name);
      else if (log.status === "TEST") test += 1;
      else sent += 1;
    } catch (error) {
      if (!(error instanceof MailError)) throw error;
      failed.push(t.name);
      stopped = true;
      break; // 1日の上限などで止まったら、それ以上は送らない
    }
  }
  return {
    sent,
    test,
    failed,
    stopped,
    skipped: targets
      .filter((t) => already.has(t.email!.toLowerCase()))
      .map((t) => t.name),
  };
}
