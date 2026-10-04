import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { countDevices, pushStatus } from "@/lib/push";

// 通知の準備ができているか(サーバーの設定と、この人の登録した端末の数)
export async function GET() {
  const user = await requireMember();
  return NextResponse.json({ ...pushStatus(), devices: await countDevices(user.id) });
}
