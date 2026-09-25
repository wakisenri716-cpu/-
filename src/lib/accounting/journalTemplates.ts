import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";

export class JournalTemplateError extends UserError {}

export type TemplateLine = { accountId: string; debit: number; credit: number; memo: string };

const MAX_TEMPLATES = 30;

function parseLines(value: unknown): TemplateLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((l: Record<string, unknown>) => ({
      accountId: String(l?.accountId ?? ""),
      debit: Math.max(0, Math.round(Number(l?.debit) || 0)),
      credit: Math.max(0, Math.round(Number(l?.credit) || 0)),
      memo: String(l?.memo ?? "").slice(0, 100),
    }))
    .filter((l) => l.accountId);
}

// 保存したひな形。削除・非表示にした科目の行は外して返す。
export async function listJournalTemplates(companyId: string) {
  const [templates, accounts] = await Promise.all([
    prisma.journalTemplate.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.account.findMany({ where: { companyId, hidden: false }, select: { id: true } }),
  ]);
  const usable = new Set(accounts.map((a) => a.id));
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    lines: parseLines(t.lines).filter((l) => usable.has(l.accountId)),
  }));
}

// 仕訳の入力内容を、名前をつけてひな形として保存する。金額は入っていればそのまま覚える(毎月同じ家賃など)。
export async function saveJournalTemplate(companyId: string, input: { name?: unknown; description?: unknown; lines?: unknown }) {
  const name = String(input.name ?? "").trim().slice(0, 30);
  if (!name) throw new JournalTemplateError("ひな形の名前を入力してください");
  const lines = parseLines(input.lines);
  if (lines.length < 2) throw new JournalTemplateError("勘定科目を2行以上選んでから保存してください");
  const ids = [...new Set(lines.map((l) => l.accountId))];
  if ((await prisma.account.count({ where: { companyId, id: { in: ids } } })) !== ids.length) {
    throw new JournalTemplateError("存在しない勘定科目が含まれています");
  }
  if ((await prisma.journalTemplate.count({ where: { companyId } })) >= MAX_TEMPLATES) {
    throw new JournalTemplateError(`ひな形は${MAX_TEMPLATES}件まで保存できます。使わないものを削除してください`);
  }
  try {
    return await prisma.journalTemplate.create({
      data: { companyId, name, description: String(input.description ?? "").trim().slice(0, 200), lines },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new JournalTemplateError(`「${name}」という名前のひな形はすでにあります`);
    }
    throw error;
  }
}

export async function deleteJournalTemplate(companyId: string, id: string) {
  const template = await prisma.journalTemplate.findFirst({ where: { id, companyId }, select: { name: true } });
  const deleted = await prisma.journalTemplate.deleteMany({ where: { id, companyId } });
  if (!template || deleted.count !== 1) throw new JournalTemplateError("ひな形が見つかりません");
  return template.name;
}
