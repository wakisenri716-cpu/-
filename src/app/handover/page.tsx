import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { prisma } from "@/lib/prisma";
import HandoverView from "./HandoverView";
import { leavePeriod, upcomingLeaves } from "@/lib/handover";

export const dynamic = "force-dynamic";

export default async function HandoverPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const [ai, users, leaves] = await Promise.all([
    aiEnabled(companyId),
    prisma.user.findMany({ where: { companyId, active: true, role: { not: "ADVISOR" } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    upcomingLeaves(companyId, 14),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">引き継ぎメモ</h1>
        <p className="mt-1 text-sm text-slate-600">
          休み・異動・退職の前に、その人の済んでいないやること・対応していない伝言・渡していない郵便物・進めている商談をまとめて、引き継ぎメモを作ります。{ai ? "「AIで要点も」を押すと、後任の人がまず見てほしいことを添えます(書いていない数字は書きません)。" : ""}選んだものは「引き継ぐ」でまとめて後任の人に移せます(管理者・経理担当)。
        </p>
      </div>
      <HandoverView users={users} viewerId={user.id} ai={ai} leaves={leaves.map((l) => ({ userId: l.userId, name: l.name, period: leavePeriod(l.dates), tasks: l.tasks, memos: l.memos, mail: l.mail }))} />
    </div>
  );
}
