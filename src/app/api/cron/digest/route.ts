import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { getTodos } from "@/lib/dashboard";
import { appUrl, sendMail } from "@/lib/mail";
import { generateBriefing } from "@/lib/assistant/briefing";
import { checkWatchAlerts } from "@/lib/watchAlerts";

// 毎朝、「やること」がある会社の管理者にメールで知らせる(Vercel Cron から呼ばれる。vercel.json 参照)。
// AIの朝のブリーフィング(今日まずやること)も作って、メールの最初に入れる。
// CRON_SECRET を知っている呼び出し元だけが実行できる。
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const baseUrl = appUrl(request);
  const companies = await prisma.company.findMany({ where: { dailyDigest: true }, select: { id: true, name: true } });
  let sent = 0;
  for (const company of companies) {
    const todos = await getTodos(company.id);
    if (!todos.length) continue;
    let briefing: Awaited<ReturnType<typeof generateBriefing>> | null = null;
    try {
      briefing = await generateBriefing(company.id);
    } catch (error) {
      // ブリーフィングが作れなくても、やることのメールは送る
      console.error("朝のブリーフィングを作れませんでした", error);
    }
    const items = (briefing?.items ?? []) as { title: string; reason: string; href: string }[];
    const admins = await prisma.user.findMany({ where: { active: true, memberships: { some: { companyId: company.id, role: "ADMIN", active: true } } }, select: { email: true, name: true } });
    const text = [
      `${company.name} の今日のやること(${todos.length}件)です。`,
      "",
      ...(briefing
        ? [
            "■ 今朝のAIブリーフィング",
            briefing.headline,
            ...items.map((item, i) => `${i + 1}. ${item.title}\n   ${item.reason}\n   ${baseUrl}${item.href}`),
            ...(briefing.notes as string[]).map((n) => `・${n}`),
            `くわしく: ${baseUrl}/briefing`,
            "",
            "■ やることの一覧",
          ]
        : []),
      ...todos.map((t) => `・${t.label}: ${t.count}件\n  ${t.detail}\n  ${baseUrl}${t.href}`),
      "",
      `ダッシュボード: ${baseUrl}/`,
      "",
      "このお知らせは「メール設定」の画面で止められます。",
    ].join("\n");
    for (const admin of admins) {
      try {
        const log = await sendMail({ companyId: company.id, kind: "DIGEST", to: admin.email, subject: `【Clerkly】今日のやること ${todos.length}件`, text, sentByName: "システム" });
        if (log.status === "SENT") sent++;
      } catch (error) {
        console.error("やることメールの送信に失敗しました", error);
      }
    }
  }
  // AIの見張り: 新しく「要確認」になったものを知らせる(毎朝のお知らせとは別にオン・オフできる)
  const watching = await prisma.company.findMany({ where: { watchAlerts: true }, select: { id: true } });
  let watchAlerts = 0;
  for (const c of watching) {
    try {
      if ((await checkWatchAlerts(c.id, baseUrl)).notified) watchAlerts++;
    } catch (error) {
      console.error("AIの見張りを確かめられませんでした", error);
    }
  }
  return NextResponse.json({ companies: companies.length, sent, watchAlerts });
}
