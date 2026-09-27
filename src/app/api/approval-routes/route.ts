import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { respond } from "@/lib/shifts/http";
import { createRoute, listRoutes } from "@/lib/approvals/service";
import { audit } from "@/lib/audit";

// 承認ルートの設定は管理者だけ
export async function GET() {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  return respond(() => listRoutes(admin.companyId));
}

export async function POST(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const route = await createRoute(admin.companyId, body);
    await audit("承認ルートを追加", route.name, admin);
    return route;
  }, 201);
}
