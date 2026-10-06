import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { MailError, appUrl, sendMail } from "@/lib/mail";

// 社内のお知らせ: 管理者・経理担当が書き、全員(従業員も)が読む。読んだ人を記録する。

type Viewer = { id: string; name: string; companyId: string; role: "ADMIN" | "ACCOUNTANT" | "EMPLOYEE" | "ADVISOR" };

const canWrite = (user: Viewer) => user.role !== "EMPLOYEE";

function parse(input: { title?: unknown; body?: unknown; pinned?: unknown }) {
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!title) throw new UserError("件名を入力してください");
  if (title.length > 100) throw new UserError("件名は100文字以内にしてください");
  if (!body) throw new UserError("本文を入力してください");
  if (body.length > 5000) throw new UserError("本文は5,000文字以内にしてください");
  return { title, body, pinned: input.pinned === true || input.pinned === "on" || input.pinned === "true" };
}

async function activeMembers(companyId: string) {
  const members = await prisma.companyMember.findMany({ where: { companyId, active: true }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return members.map((m) => m.user);
}

export async function listAnnouncements(user: Viewer) {
  const [items, members] = await Promise.all([
    prisma.announcement.findMany({
      where: { companyId: user.companyId },
      include: { reads: { select: { userId: true, readAt: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    canWrite(user) ? activeMembers(user.companyId) : Promise.resolve([]),
  ]);
  return {
    canWrite: canWrite(user),
    items: items.map((a) => {
      const readers = new Set(a.reads.map((r) => r.userId));
      return {
        id: a.id,
        title: a.title,
        body: a.body,
        pinned: a.pinned,
        authorName: a.authorName,
        createdAt: a.createdAt.toISOString(),
        edited: a.updatedAt.getTime() - a.createdAt.getTime() > 60_000,
        read: readers.has(user.id),
        // 書く人にだけ、読んだ人・まだの人を見せる
        ...(canWrite(user)
          ? {
              readCount: members.filter((m) => readers.has(m.id)).length,
              memberCount: members.length,
              unreadNames: members.filter((m) => !readers.has(m.id)).map((m) => m.name),
            }
          : {}),
      };
    }),
  };
}

// メールでも知らせるときは、メールアドレスのある全員に送る(1日の送信上限に達したらそこで止める)
async function notifyByMail(user: Viewer, announcement: { id: string; title: string; body: string }, request?: Request) {
  const members = await activeMembers(user.companyId);
  let sent = 0;
  for (const m of members) {
    if (!m.email || m.id === user.id) continue;
    try {
      await sendMail({
        companyId: user.companyId,
        kind: "NOTICE",
        to: m.email,
        subject: `【お知らせ】${announcement.title}`,
        text: `${m.name}さん\n\n${user.name}さんから社内のお知らせです。\n\n${announcement.title}\n\n${announcement.body}\n\nお知らせの一覧: ${appUrl(request)}/notices\n`,
        sentByName: user.name,
        relatedId: announcement.id,
      });
      sent++;
    } catch (error) {
      if (error instanceof MailError) break;
      throw error;
    }
  }
  return sent;
}

export async function createAnnouncement(user: Viewer, input: { title?: unknown; body?: unknown; pinned?: unknown; notify?: unknown }, request?: Request) {
  if (!canWrite(user)) throw new UserError("お知らせは管理者・経理担当が書けます");
  const data = parse(input);
  const announcement = await prisma.announcement.create({ data: { companyId: user.companyId, authorName: user.name, ...data } });
  // 書いた本人は読んだことにする
  await prisma.announcementRead.create({ data: { announcementId: announcement.id, userId: user.id } });
  const mailed = input.notify === true || input.notify === "on" ? await notifyByMail(user, announcement, request) : 0;
  return { announcement, mailed };
}

export async function updateAnnouncement(user: Viewer, id: string, input: { title?: unknown; body?: unknown; pinned?: unknown }) {
  if (!canWrite(user)) throw new UserError("お知らせは管理者・経理担当が直せます");
  const current = await prisma.announcement.findFirst({ where: { id, companyId: user.companyId } });
  if (!current) throw new UserError("お知らせが見つかりません");
  // 「上に固定」だけの切り替えなら、ほかは今のまま
  const data = input.title === undefined && input.body === undefined ? { pinned: !!input.pinned } : parse(input);
  return prisma.announcement.update({ where: { id }, data });
}

export async function deleteAnnouncement(user: Viewer, id: string) {
  if (!canWrite(user)) throw new UserError("お知らせは管理者・経理担当が消せます");
  const current = await prisma.announcement.findFirst({ where: { id, companyId: user.companyId } });
  if (!current) throw new UserError("お知らせが見つかりません");
  await prisma.announcement.delete({ where: { id } });
  return current;
}

export async function markRead(user: Viewer, id: string) {
  const current = await prisma.announcement.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!current) throw new UserError("お知らせが見つかりません");
  await prisma.announcementRead.upsert({ where: { announcementId_userId: { announcementId: id, userId: user.id } }, update: {}, create: { announcementId: id, userId: user.id } });
}

// まだ読んでいないお知らせ(新しい順に最大3件と件数)。ダッシュボード・経費精算の画面の上に出す
export async function unreadAnnouncements(user: Pick<Viewer, "id" | "companyId">) {
  const where = { companyId: user.companyId, reads: { none: { userId: user.id } } };
  const [count, latest] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({ where, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 3, select: { id: true, title: true } }),
  ]);
  return { count, latest };
}
