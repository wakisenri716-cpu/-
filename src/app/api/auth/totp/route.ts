import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";

export async function GET() {
  const user = await requireUser();
  const remaining = user.recoveryCodes ? (JSON.parse(user.recoveryCodes) as string[]).length : 0;
  return NextResponse.json({ enabled: user.totpEnabled, recoveryCodesRemaining: remaining });
}
