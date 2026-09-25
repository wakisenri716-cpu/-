import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";

// 書類フォルダ: 会社の書類(契約書・PDF・写真など)をフォルダに分けて保存する。
// ファイルの中身は DB に保存する。Vercel の1回の送信上限(4.5MB)に収まるよう、1ファイル 4MB まで。

export class FileError extends UserError {}

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FOLDERS = 500;
const MAX_DEPTH = 10;

// ブラウザで表示・印刷できる種類。中身の先頭バイトで判定し、それ以外はダウンロードだけにする
// (HTML などを同じドメインで開かせないため)。
export type Viewable = "pdf" | "image" | null;
export const INLINE_TYPES: Record<string, Viewable> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
};

export function sniffType(data: Uint8Array): string | null {
  const b = (i: number) => data[i];
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b(0) === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function viewableOf(mimeType: string): Viewable {
  return INLINE_TYPES[mimeType] ?? null;
}

// ファイル名・フォルダ名からパスの区切りや制御文字を取り除く
function cleanName(raw: unknown, max = 100) {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, max);
  return name === "." || name === ".." ? "" : name;
}

async function findFolder(companyId: string, id: string | null) {
  if (!id) return null;
  const folder = await prisma.folder.findFirst({ where: { id, companyId } });
  if (!folder) throw new FileError("フォルダが見つかりません");
  return folder;
}

// いちばん上からそのフォルダまでの並び(パンくず用)
export async function folderPath(companyId: string, id: string | null) {
  const path: { id: string; name: string }[] = [];
  let current = id;
  while (current && path.length <= MAX_DEPTH + 1) {
    const folder = await prisma.folder.findFirst({ where: { id: current, companyId }, select: { id: true, name: true, parentId: true } });
    if (!folder) break;
    path.unshift({ id: folder.id, name: folder.name });
    current = folder.parentId;
  }
  return path;
}

const FILE_FIELDS = { id: true, name: true, mimeType: true, size: true, memo: true, uploadedByName: true, createdAt: true, folderId: true } as const;

export async function listFolder(companyId: string, folderId: string | null) {
  const folder = await findFolder(companyId, folderId);
  const [path, folders, files, usage] = await Promise.all([
    folderPath(companyId, folderId),
    prisma.folder.findMany({
      where: { companyId, parentId: folderId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, createdAt: true, _count: { select: { children: true, files: true } } },
    }),
    prisma.storedFile.findMany({ where: { companyId, folderId }, orderBy: { createdAt: "desc" }, select: FILE_FIELDS }),
    prisma.storedFile.aggregate({ where: { companyId }, _sum: { size: true }, _count: true }),
  ]);
  return {
    folder: folder && { id: folder.id, name: folder.name, parentId: folder.parentId },
    path,
    folders: folders.map((f) => ({ id: f.id, name: f.name, folderCount: f._count.children, fileCount: f._count.files })),
    files: files.map((f) => ({ ...f, viewable: viewableOf(f.mimeType) })),
    usage: { bytes: usage._sum.size ?? 0, files: usage._count },
  };
}

// 移動先を選ぶための全フォルダ(「親 / 子」の形の名前つき)
export async function allFolders(companyId: string) {
  const folders = await prisma.folder.findMany({ where: { companyId }, select: { id: true, name: true, parentId: true } });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const label = (f: (typeof folders)[number]) => {
    const names = [f.name];
    let parent = f.parentId ? byId.get(f.parentId) : undefined;
    while (parent && names.length <= MAX_DEPTH + 1) {
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.join(" / ");
  };
  return folders.map((f) => ({ id: f.id, label: label(f) })).sort((a, b) => a.label.localeCompare(b.label, "ja"));
}

async function assertUniqueFolderName(companyId: string, parentId: string | null, name: string, exceptId?: string) {
  const same = await prisma.folder.findFirst({ where: { companyId, parentId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  if (same) throw new FileError(`「${name}」という名前のフォルダはすでにあります`);
}

export async function createFolder(companyId: string, input: { name?: unknown; parentId?: unknown }) {
  const name = cleanName(input.name, 50);
  if (!name) throw new FileError("フォルダの名前を入力してください");
  const parentId = input.parentId ? String(input.parentId) : null;
  await findFolder(companyId, parentId);
  if ((await folderPath(companyId, parentId)).length >= MAX_DEPTH) throw new FileError(`フォルダは${MAX_DEPTH}階層までです`);
  if ((await prisma.folder.count({ where: { companyId } })) >= MAX_FOLDERS) throw new FileError(`フォルダは${MAX_FOLDERS}個までです`);
  await assertUniqueFolderName(companyId, parentId, name);
  return prisma.folder.create({ data: { companyId, parentId, name } });
}

// 名前の変更・別のフォルダへの移動。自分自身や自分の中のフォルダには移動できない。
export async function updateFolder(companyId: string, id: string, input: { name?: unknown; parentId?: unknown }) {
  const folder = await findFolder(companyId, id);
  if (!folder) throw new FileError("フォルダが見つかりません");
  const name = input.name === undefined ? folder.name : cleanName(input.name, 50);
  if (!name) throw new FileError("フォルダの名前を入力してください");
  const parentId = input.parentId === undefined ? folder.parentId : input.parentId ? String(input.parentId) : null;
  if (parentId !== folder.parentId) {
    await findFolder(companyId, parentId);
    const path = await folderPath(companyId, parentId);
    if (path.some((p) => p.id === id)) throw new FileError("フォルダを、そのフォルダ自身や中のフォルダには移動できません");
    if (path.length >= MAX_DEPTH) throw new FileError(`フォルダは${MAX_DEPTH}階層までです`);
  }
  await assertUniqueFolderName(companyId, parentId, name, id);
  return prisma.folder.update({ where: { id }, data: { name, parentId } });
}

// 空のフォルダだけ削除できる(中身をうっかり消さないため)
export async function deleteFolder(companyId: string, id: string) {
  const folder = await prisma.folder.findFirst({ where: { id, companyId }, include: { _count: { select: { children: true, files: true } } } });
  if (!folder) throw new FileError("フォルダが見つかりません");
  if (folder._count.children > 0 || folder._count.files > 0) {
    throw new FileError("中にファイルやフォルダがあるため削除できません。先に中身を移動するか削除してください");
  }
  await prisma.folder.delete({ where: { id } });
  return folder.name;
}

// 同じフォルダに同じ名前があれば「名前 (2).pdf」のように番号をつける
async function uniqueFileName(companyId: string, folderId: string | null, name: string, exceptId?: string) {
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const taken = new Set(
    (await prisma.storedFile.findMany({ where: { companyId, folderId, name: { startsWith: base }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { name: true } })).map((f) => f.name),
  );
  if (!taken.has(name)) return name;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

export async function saveFile(companyId: string, input: { file: File; folderId: string | null; uploadedByName: string }) {
  const { file } = input;
  if (file.size === 0) throw new FileError("空のファイルは保存できません");
  if (file.size > MAX_FILE_BYTES) throw new FileError(`「${file.name}」は大きすぎます(1ファイル4MBまで)`);
  await findFolder(companyId, input.folderId);
  const name = cleanName(file.name) || "名前のないファイル";
  const data = new Uint8Array(await file.arrayBuffer());
  const declared = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type.slice(0, 100) : "application/octet-stream";
  // 表示できる種類は中身で判定したものだけ(拡張子や申告された種類は信用しない)
  const mimeType = sniffType(data) ?? (viewableOf(declared) ? "application/octet-stream" : declared);
  return prisma.storedFile.create({
    data: { companyId, folderId: input.folderId, name: await uniqueFileName(companyId, input.folderId, name), mimeType, size: data.byteLength, data, uploadedByName: input.uploadedByName },
    select: FILE_FIELDS,
  });
}

export async function getFileMeta(companyId: string, id: string) {
  const file = await prisma.storedFile.findFirst({ where: { id, companyId }, select: FILE_FIELDS });
  return file && { ...file, viewable: viewableOf(file.mimeType), path: await folderPath(companyId, file.folderId) };
}

export async function getFileContent(companyId: string, id: string) {
  return prisma.storedFile.findFirst({ where: { id, companyId }, select: { name: true, mimeType: true, data: true } });
}

export async function updateFile(companyId: string, id: string, input: { name?: unknown; folderId?: unknown; memo?: unknown }) {
  const file = await prisma.storedFile.findFirst({ where: { id, companyId }, select: { name: true, folderId: true } });
  if (!file) throw new FileError("ファイルが見つかりません");
  const folderId = input.folderId === undefined ? file.folderId : input.folderId ? String(input.folderId) : null;
  await findFolder(companyId, folderId);
  const requested = input.name === undefined ? file.name : cleanName(input.name);
  if (!requested) throw new FileError("ファイルの名前を入力してください");
  const name = requested === file.name && folderId === file.folderId ? file.name : await uniqueFileName(companyId, folderId, requested, id);
  return prisma.storedFile.update({
    where: { id },
    data: { name, folderId, ...(input.memo !== undefined ? { memo: String(input.memo ?? "").trim().slice(0, 200) || null } : {}) },
    select: FILE_FIELDS,
  });
}

export async function deleteFile(companyId: string, id: string) {
  const file = await prisma.storedFile.findFirst({ where: { id, companyId }, select: { name: true } });
  const deleted = await prisma.storedFile.deleteMany({ where: { id, companyId } });
  if (!file || deleted.count !== 1) throw new FileError("ファイルが見つかりません");
  return file.name;
}

// ファイル名・メモで全フォルダから探す
export async function searchFiles(companyId: string, q: string) {
  const text = q.trim().slice(0, 100);
  if (!text) return [];
  const [files, folders] = await Promise.all([
    prisma.storedFile.findMany({
      where: { companyId, OR: [{ name: { contains: text, mode: "insensitive" } }, { memo: { contains: text, mode: "insensitive" } }] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: FILE_FIELDS,
    }),
    allFolders(companyId),
  ]);
  const labels = new Map(folders.map((f) => [f.id, f.label]));
  return files.map((f) => ({ ...f, viewable: viewableOf(f.mimeType), folderLabel: f.folderId ? (labels.get(f.folderId) ?? "") : "" }));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}
