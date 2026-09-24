import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

type Actor = { id: string; name: string; companyId: string };

// 操作ログを残す。ログの失敗で本来の処理を失敗させないよう、例外は握りつぶして記録だけ出す。
export async function audit(action: string, detail?: string | null, actor?: Actor | null) {
  try {
    const user = actor ?? (await getCurrentUser());
    if (!user) return;
    await prisma.auditLog.create({
      data: { companyId: user.companyId, userId: user.id, userName: user.name, action, detail: detail ? detail.slice(0, 500) : null },
    });
  } catch (error) {
    console.error("操作ログの記録に失敗しました", error);
  }
}

export function yen(n: number) {
  return `¥${n.toLocaleString("ja-JP")}`;
}

export async function listAuditLogs(companyId: string, opts: { before?: string | null; action?: string | null; take?: number } = {}) {
  const take = opts.take ?? 100;
  const logs = await prisma.auditLog.findMany({
    where: {
      companyId,
      ...(opts.before && !Number.isNaN(Date.parse(opts.before)) ? { createdAt: { lt: new Date(opts.before) } } : {}),
      ...(opts.action ? { action: opts.action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });
  const actions = await prisma.auditLog.findMany({ where: { companyId }, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } });
  return { logs: logs.slice(0, take), hasMore: logs.length > take, actions: actions.map((a) => a.action) };
}
