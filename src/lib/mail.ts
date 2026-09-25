import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";

// メール送信。Vercel の環境変数で送り方を決める(未設定なら「テストモード」で、送らずに記録だけ残す)。
//  - Gmail など(SMTP): SMTP_HOST・SMTP_PORT・SMTP_USER・SMTP_PASS(Gmail はアプリ パスワード)・MAIL_FROM(省略時は SMTP_USER)
//  - Resend: RESEND_API_KEY・MAIL_FROM(Resend で確認済みのドメインのアドレス)
// 本文はテキストのみ(HTML は使わない)。

export class MailError extends UserError {}

export type MailMode = "smtp" | "resend" | "test";
export type MailKind = "INVOICE" | "QUOTE" | "REMINDER" | "PASSWORD_RESET" | "DIGEST" | "TEST";

const DAILY_LIMIT = 200; // 1社1日あたりの送信上限(誤操作・乗っ取り時の大量送信を防ぐ)
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

export function mailMode(): MailMode {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) return "resend";
  return "test";
}

export function fromAddress() {
  return (process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();
}

export const MODE_LABELS: Record<MailMode, string> = {
  smtp: "メールサーバー(Gmail など)で送信",
  resend: "Resend で送信",
  test: "テストモード(実際には送らず、送信履歴に記録だけします)",
};

export function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().normalize("NFKC");
  if (!email || email.length > 254 || !EMAIL.test(email)) throw new MailError("メールアドレスを正しく入力してください");
  return email;
}

// 件名・表示名に改行が入るとヘッダーを書き換えられるので取り除く
const oneLine = (text: string, max: number) => text.replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, max);

// アプリのURL(メール本文のリンク用)。本番は APP_URL か Vercel の本番ドメイン、なければ今のリクエストの URL
export function appUrl(request?: Request) {
  const configured = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (configured) return configured.replace(/\/+$/, "");
  return request ? new URL(request.url).origin : "http://localhost:3000";
}

async function deliver(input: { to: string; subject: string; text: string; fromName: string; replyTo: string | null }) {
  const from = fromAddress();
  if (mailMode() === "smtp") {
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // 応答がないときに画面が固まらないよう、早めに諦める
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({
      from: { name: input.fromName, address: from },
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${input.fromName.replace(/[<>"]/g, "")} <${from}>`,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// 1通送って記録する。logBody を渡すと、記録にはそちらを残す(パスワード再設定のリンクなどを記録に残さないため)。
export async function sendMail(input: {
  companyId: string;
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  sentByName: string;
  relatedId?: string | null;
  logBody?: string;
}) {
  const to = normalizeEmail(input.to);
  const subject = oneLine(input.subject, 200);
  if (!subject) throw new MailError("件名を入力してください");
  const text = input.text.replace(/\r\n/g, "\n").slice(0, 20_000);
  if (!text.trim()) throw new MailError("本文を入力してください");

  const since = new Date(Date.now() - 86_400_000);
  if ((await prisma.emailLog.count({ where: { companyId: input.companyId, createdAt: { gte: since }, status: { not: "FAILED" } } })) >= DAILY_LIMIT) {
    throw new MailError(`メールは1日${DAILY_LIMIT}通までです。時間をおいてから送ってください`);
  }

  const company = await prisma.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { name: true, email: true } });
  const mode = mailMode();
  let status = "TEST";
  let error: string | null = null;
  if (mode !== "test") {
    try {
      await deliver({ to, subject, text, fromName: oneLine(company.name, 60) || "経理AI", replyTo: company.email });
      status = "SENT";
    } catch (e) {
      status = "FAILED";
      error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    }
  }
  const log = await prisma.emailLog.create({
    data: {
      companyId: input.companyId,
      kind: input.kind,
      to,
      subject,
      body: input.logBody ?? text,
      status,
      error,
      relatedId: input.relatedId ?? null,
      sentByName: input.sentByName,
    },
  });
  return log;
}

export async function listEmailLogs(companyId: string, take = 100) {
  return prisma.emailLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take });
}
