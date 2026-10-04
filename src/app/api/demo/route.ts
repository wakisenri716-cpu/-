import { NextResponse } from "next/server";
import { getCurrentSessionId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listMyCompanies, switchCompany } from "@/lib/auth/companies";
import { createDemoCompany, findDemoCompany, hideDemoCompany } from "@/lib/demo";
import { audit } from "@/lib/audit";

// お試し用の会社(サンプルデータ入り)を作って開く。すでにあればそれを開く
export async function POST() {
  const user = await requireMember();
  if (user.role === "EMPLOYEE") return NextResponse.json({ error: "お試し用の会社は、管理者・経理担当が作れます" }, { status: 403 });
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return NextResponse.json({ error: "ログインし直してください" }, { status: 401 });
  return respond(async () => {
    const existed = await findDemoCompany(user.id);
    const companyId = await createDemoCompany(user.id);
    const company = await switchCompany(sessionId, user.id, companyId);
    if (!existed) await audit("お試し用の会社を作成", company.name, { ...user, companyId });
    return company;
  }, 201);
}

// お試し用の会社をしまって、自分の会社に戻る
export async function DELETE() {
  const user = await requireMember();
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return NextResponse.json({ error: "ログインし直してください" }, { status: 401 });
  return respond(async () => {
    const demoId = await findDemoCompany(user.id);
    if (!demoId) return { ok: true };
    await hideDemoCompany(user.id, demoId);
    const back = (await listMyCompanies(user.id))[0];
    if (back) await switchCompany(sessionId, user.id, back.id);
    return { ok: true };
  });
}
