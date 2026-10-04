import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { savePolicy } from "@/lib/travel";
import { audit } from "@/lib/audit";

// 出張旅費規程の金額(管理者・経理担当)
export async function PUT(request: Request) {
  const user = await requireMember();
  if (user.role === "EMPLOYEE") return NextResponse.json({ error: "規程は管理者・経理担当が決めます" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const p = await savePolicy(user.companyId, body);
    await audit("出張旅費規程を変更", `日帰り${p.dayTripAllowance}円・宿泊日当${p.dailyAllowance}円・宿泊費${p.lodging}円`);
    return p;
  });
}
