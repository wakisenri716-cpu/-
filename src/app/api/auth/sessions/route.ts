import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSessionId, requireUser } from "@/lib/auth/session";
import { describeDevice } from "@/lib/auth/devices";
import { audit } from "@/lib/audit";

// 自分がログインしている端末の一覧
export async function GET() {
  const user = await requireUser();
  const currentId = await getCurrentSessionId();
  const sessions = await prisma.session.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(
    sessions.map((s) => ({ id: s.id, device: describeDevice(s.userAgent), createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === currentId })),
  );
}

// この端末以外をすべてログアウトさせる
export async function DELETE() {
  const user = await requireUser();
  const currentId = await getCurrentSessionId();
  const { count } = await prisma.session.deleteMany({ where: { userId: user.id, ...(currentId ? { id: { not: currentId } } : {}) } });
  if (count) await audit("ほかの端末をログアウト", `${count}台`, user);
  return NextResponse.json({ count });
}
