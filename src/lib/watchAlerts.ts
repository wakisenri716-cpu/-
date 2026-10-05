import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { sendToUsers } from "@/lib/push";
import { getWatches, type Watch } from "@/lib/aiWatch";

// AIの見張りの知らせ: 前に確かめたときは「要確認」でなかった見張りが「要確認」になったら、管理者にメールとスマホで知らせる。
// 同じ要確認が続くあいだは、もう一度は知らせない(解消してからまた要確認になったら知らせる)。

const KIND = "WATCH_STATE";
const KEY = "latest";

export async function checkWatchAlerts(companyId: string, baseUrl: string, now = new Date()) {
  const [watches, prev, company] = await Promise.all([
    getWatches(companyId),
    prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: KIND, key: KEY } } }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, watchAlerts: true } }),
  ]);
  const before = new Set(((prev?.data as { warn?: string[] } | null)?.warn ?? []) as string[]);
  const warn = watches.filter((w) => w.status === "warn");
  const fresh: Watch[] = warn.filter((w) => !before.has(w.key));
  const data = { warn: warn.map((w) => w.key), checkedAt: now.toISOString() };
  await prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: KIND, key: KEY } },
    create: { companyId, kind: KIND, key: KEY, data, mode: "rule", createdBy: "システム" },
    update: { data, createdAt: now },
  });
  let mailed = 0;
  let pushed = 0;
  if (fresh.length && company.watchAlerts) {
    const admins = await prisma.user.findMany({ where: { active: true, memberships: { some: { companyId, role: "ADMIN", active: true } } }, select: { id: true, email: true } });
    const text = [
      `${company.name} のAIの見張りで、新しく確かめたいことが ${fresh.length}件 見つかりました。`,
      "",
      ...fresh.map((w) => [`■ ${w.label}`, w.headline, ...w.items.slice(0, 3).map((i) => `・${i}`), `${baseUrl}${w.href}`, ""].join("\n")),
      `AIの見張り: ${baseUrl}/ai-watch`,
      "",
      "このお知らせは「メール設定」の画面で止められます。",
    ].join("\n");
    for (const a of admins) {
      try {
        const log = await sendMail({ companyId, kind: "WATCH", to: a.email, subject: `【AIの見張り】確かめたいことが ${fresh.length}件 あります`, text, sentByName: "システム" });
        if (log.status !== "FAILED") mailed++;
      } catch (error) {
        console.error("見張りの知らせを送れませんでした", error);
      }
    }
    try {
      pushed = (await sendToUsers(admins.map((a) => a.id), { title: `AIの見張り: ${fresh.map((w) => w.label).join("・")}`, body: fresh[0].headline, url: "/ai-watch" })).sent;
    } catch (error) {
      console.error("見張りのプッシュ通知を送れませんでした", error);
    }
  }
  return { warn: warn.map((w) => w.label), fresh: fresh.map((w) => ({ label: w.label, headline: w.headline })), notified: company.watchAlerts && fresh.length > 0, mailed, pushed };
}
