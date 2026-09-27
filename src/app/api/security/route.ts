import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { adminOr403 } from "@/lib/auth/users";
import { respond } from "@/lib/shifts/http";
import { clientIp, IDLE_OPTIONS, securityReport, updateSecuritySettings } from "@/lib/security";
import { audit } from "@/lib/audit";

// 安全の設定と点検(管理者だけ)
export async function GET() {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const ip = clientIp(await headers());
  return respond(async () => ({ ...(await securityReport(admin.companyId)), currentIp: ip }));
}

export async function PATCH(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const settings = await updateSecuritySettings(admin.companyId, body, clientIp(request.headers));
    await audit(
      "安全の設定を変更",
      [
        `2段階認証の必須: ${settings.require2fa ? "オン" : "オフ"}`,
        `自動ログアウト: ${IDLE_OPTIONS.find((o) => o.minutes === settings.sessionIdleMinutes)?.label}`,
        `IP制限: ${settings.allowedIps ? settings.allowedIps.split("\n").join(" ") : "なし"}`,
        `ログインのお知らせ: ${settings.loginAlert ? "オン" : "オフ"}`,
      ].join(" / "),
      admin,
    );
    return settings;
  });
}
