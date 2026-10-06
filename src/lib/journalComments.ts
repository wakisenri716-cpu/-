import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 仕訳へのコメント: 税理士(閲覧だけ)からの質問と、会社からの回答。
// 「未解決」は、まだ解決済みにしていない税理士のコメント。解決済みにするのは、税理士・会社のどちらでもよい。

const MAX_BODY = 1000;
type Author = { id: string; name: string; role: string };

export const ROLE_LABELS: Record<string, string> = { ADMIN: "管理者", ACCOUNTANT: "経理担当", ADVISOR: "税理士", EMPLOYEE: "従業員" };

export async function listComments(companyId: string, entryId: string) {
  const rows = await prisma.journalComment.findMany({ where: { companyId, journalEntryId: entryId }, orderBy: { createdAt: "asc" } });
  return rows.map((c) => ({ id: c.id, userName: c.userName, role: c.role, roleLabel: ROLE_LABELS[c.role] ?? c.role, body: c.body, resolved: !!c.resolvedAt, resolvedBy: c.resolvedBy, createdAt: c.createdAt }));
}

export async function addComment(companyId: string, user: Author, entryId: string, bodyInput: unknown) {
  const body = String(bodyInput ?? "").trim();
  if (!body) throw new UserError("コメントを入力してください");
  if (body.length > MAX_BODY) throw new UserError(`コメントは${MAX_BODY}文字までです`);
  const entry = await prisma.journalEntry.findFirst({ where: { id: entryId, companyId }, select: { id: true, description: true } });
  if (!entry) throw new UserError("仕訳が見つかりません");
  await prisma.journalComment.create({ data: { companyId, journalEntryId: entryId, userId: user.id, userName: user.name, role: user.role, body } });
  return { entry, comments: await listComments(companyId, entryId) };
}

// 解決済みにする(この仕訳の未解決のコメントをまとめて)/ 未解決に戻す
export async function setResolved(companyId: string, user: Author, entryId: string, resolved: boolean) {
  const entry = await prisma.journalEntry.findFirst({ where: { id: entryId, companyId }, select: { id: true, description: true } });
  if (!entry) throw new UserError("仕訳が見つかりません");
  await prisma.journalComment.updateMany({
    where: { companyId, journalEntryId: entryId, ...(resolved ? { resolvedAt: null } : { resolvedAt: { not: null } }) },
    data: resolved ? { resolvedAt: new Date(), resolvedBy: user.name } : { resolvedAt: null, resolvedBy: null },
  });
  return { entry, comments: await listComments(companyId, entryId) };
}

// 仕訳帳の一覧に出すコメントの数(全部・未解決)
export async function commentCounts(companyId: string, entryIds: string[]) {
  if (!entryIds.length) return {};
  const rows = await prisma.journalComment.groupBy({ by: ["journalEntryId"], where: { companyId, journalEntryId: { in: entryIds } }, _count: { _all: true } });
  const open = await prisma.journalComment.groupBy({ by: ["journalEntryId"], where: { companyId, journalEntryId: { in: entryIds }, resolvedAt: null, role: "ADVISOR" }, _count: { _all: true } });
  const openBy = new Map(open.map((o) => [o.journalEntryId, o._count._all]));
  return Object.fromEntries(rows.map((r) => [r.journalEntryId, { total: r._count._all, open: openBy.get(r.journalEntryId) ?? 0 }]));
}

// 未解決の質問がある仕訳の数(ダッシュボードのやること)
export async function countOpenThreads(companyId: string) {
  const rows = await prisma.journalComment.groupBy({ by: ["journalEntryId"], where: { companyId, resolvedAt: null, role: "ADVISOR" } });
  return rows.length;
}

// 「税理士とのやりとり」の画面: コメントのある仕訳(未解決を先に、新しい順)
export async function listThreads(companyId: string, { open }: { open: boolean }) {
  const latest = await prisma.journalComment.groupBy({
    by: ["journalEntryId"],
    where: { companyId, ...(open ? { resolvedAt: null } : {}) },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 100,
  });
  const ids = latest.map((l) => l.journalEntryId);
  const [entries, comments] = await Promise.all([
    prisma.journalEntry.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, date: true, description: true, status: true, lines: { select: { debit: true, credit: true, account: { select: { name: true } } } } } }),
    prisma.journalComment.findMany({ where: { companyId, journalEntryId: { in: ids } }, orderBy: { createdAt: "asc" } }),
  ]);
  const byId = new Map(entries.map((e) => [e.id, e]));
  return ids
    .map((id) => {
      const e = byId.get(id);
      if (!e) return null;
      const cs = comments.filter((c) => c.journalEntryId === id);
      return {
        entryId: id,
        date: jstDateKey(e.date),
        description: e.description,
        amount: e.lines.reduce((s, l) => s + l.debit, 0),
        debit: [...new Set(e.lines.filter((l) => l.debit > 0).map((l) => l.account.name))].join("・"),
        credit: [...new Set(e.lines.filter((l) => l.credit > 0).map((l) => l.account.name))].join("・"),
        open: cs.some((c) => !c.resolvedAt && c.role === "ADVISOR"),
        comments: cs.map((c) => ({ id: c.id, userName: c.userName, roleLabel: ROLE_LABELS[c.role] ?? c.role, role: c.role, body: c.body, resolved: !!c.resolvedAt, createdAt: c.createdAt })),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
}
