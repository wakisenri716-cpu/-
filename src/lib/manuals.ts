import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 社内マニュアル: 管理者が書き(写真も付けられる)、スタッフがスマホで読んで「読みました」を押す。
// 内容を直したら、読み直してもらうため未読に戻る。

export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type Input = { title?: unknown; category?: unknown; body?: unknown; pinned?: unknown; published?: unknown };

function parse(input: Input) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new UserError("タイトルを入力してください");
  if (title.length > 80) throw new UserError("タイトルは80文字以内で入力してください");
  const category = String(input.category ?? "").trim();
  if (category.length > 30) throw new UserError("分類は30文字以内で入力してください");
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) throw new UserError("本文を入力してください");
  if (body.length > 20_000) throw new UserError("本文は20,000文字以内で入力してください");
  return { title, category: category || null, body, pinned: input.pinned === true || input.pinned === "on", published: input.published !== false && input.published !== "false" };
}

export async function createManual(companyId: string, input: Input) {
  return prisma.manual.create({ data: { companyId, ...parse(input) } });
}

export async function updateManual(companyId: string, id: string, input: Input) {
  const current = await prisma.manual.findFirst({ where: { id, companyId } });
  if (!current) throw new UserError("マニュアルが見つかりません");
  const manual = await prisma.manual.update({ where: { id }, data: parse(input) });
  return { manual, wasPublished: current.published };
}

export async function deleteManual(companyId: string, id: string) {
  const current = await prisma.manual.findFirst({ where: { id, companyId } });
  if (!current) throw new UserError("マニュアルが見つかりません");
  await prisma.manual.delete({ where: { id } });
  return current;
}

// 管理者用: 全部のマニュアルと、誰が読んだか
export async function listManualsForAdmin(companyId: string) {
  const [manuals, members] = await Promise.all([
    prisma.manual.findMany({
      where: { companyId },
      include: { reads: { include: { user: { select: { id: true, name: true } } } }, images: { select: { id: true, caption: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.companyMember.findMany({ where: { companyId, active: true }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  return {
    members: members.map((m) => m.user),
    categories: [...new Set(manuals.map((m) => m.category).filter((c): c is string => !!c))].sort(),
    manuals: manuals.map((m) => {
      // 最後に直したあとに読んだ人だけ「既読」
      const readers = m.reads.filter((r) => r.readAt >= m.updatedAt).map((r) => r.user);
      return {
        id: m.id,
        title: m.title,
        category: m.category,
        body: m.body,
        pinned: m.pinned,
        published: m.published,
        updatedAt: jstDateKey(m.updatedAt),
        images: m.images,
        readers,
        unread: members.filter((u) => !readers.some((r) => r.id === u.user.id)).map((u) => u.user),
      };
    }),
  };
}

// スタッフ用: 公開中のマニュアルと、自分が読んだか
export async function listManualsForUser(companyId: string, userId: string) {
  const manuals = await prisma.manual.findMany({
    where: { companyId, published: true },
    include: { reads: { where: { userId } }, _count: { select: { images: true } } },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });
  const rows = manuals.map((m) => ({
    id: m.id,
    title: m.title,
    category: m.category,
    pinned: m.pinned,
    updatedAt: jstDateKey(m.updatedAt),
    excerpt: m.body.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").slice(0, 60),
    images: m._count.images,
    read: !!m.reads[0] && m.reads[0].readAt >= m.updatedAt,
  }));
  return { manuals: rows, categories: [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort(), unread: rows.filter((r) => !r.read).length };
}

export async function getManualForUser(companyId: string, userId: string, id: string, includeDrafts = false) {
  const m = await prisma.manual.findFirst({
    where: { id, companyId, ...(includeDrafts ? {} : { published: true }) },
    include: { reads: { where: { userId } }, images: { select: { id: true, caption: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!m) return null;
  return {
    id: m.id,
    title: m.title,
    category: m.category,
    body: m.body,
    published: m.published,
    updatedAt: jstDateKey(m.updatedAt),
    images: m.images,
    read: !!m.reads[0] && m.reads[0].readAt >= m.updatedAt,
  };
}

export async function markRead(companyId: string, userId: string, id: string) {
  const m = await prisma.manual.findFirst({ where: { id, companyId, published: true } });
  if (!m) throw new UserError("マニュアルが見つかりません");
  await prisma.manualRead.upsert({ where: { manualId_userId: { manualId: id, userId } }, create: { manualId: id, userId }, update: { readAt: new Date() } });
  return m;
}

export async function countUnreadManuals(companyId: string, userId: string) {
  return (await listManualsForUser(companyId, userId)).unread;
}

// ---- 写真 ----

export async function addImage(companyId: string, manualId: string, file: File, caption: unknown) {
  const m = await prisma.manual.findFirst({ where: { id: manualId, companyId }, include: { _count: { select: { images: true } } } });
  if (!m) throw new UserError("マニュアルが見つかりません");
  if (m._count.images >= MAX_IMAGES) throw new UserError(`写真は1つのマニュアルに${MAX_IMAGES}枚までです`);
  if (!IMAGE_TYPES.includes(file.type)) throw new UserError("写真はJPEG・PNG・WebP・GIFで選んでください");
  if (file.size > MAX_IMAGE_BYTES) throw new UserError("写真が大きすぎます(3MBまで)");
  const data = Buffer.from(await file.arrayBuffer());
  const image = await prisma.manualImage.create({
    data: { manualId, mimeType: file.type, size: file.size, data, caption: String(caption ?? "").trim().slice(0, 100) || null, sortOrder: m._count.images },
  });
  // 写真を足したら内容が変わったので、読み直してもらう
  await prisma.manual.update({ where: { id: manualId }, data: { updatedAt: new Date() } });
  return { id: image.id, manual: m };
}

export async function deleteImage(companyId: string, imageId: string) {
  const image = await prisma.manualImage.findFirst({ where: { id: imageId, manual: { companyId } }, include: { manual: { select: { id: true, title: true } } } });
  if (!image) throw new UserError("写真が見つかりません");
  await prisma.manualImage.delete({ where: { id: imageId } });
  return image;
}

export async function getImage(companyId: string, imageId: string, includeDrafts: boolean) {
  return prisma.manualImage.findFirst({ where: { id: imageId, manual: { companyId, ...(includeDrafts ? {} : { published: true }) } }, select: { data: true, mimeType: true } });
}
