import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { respond } from "@/lib/shifts/http";
import { deleteRoute } from "@/lib/approvals/service";
import { audit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  return respond(async () => {
    const route = await deleteRoute(admin.companyId, id);
    await audit("承認ルートを削除", route.name, admin);
  });
}
