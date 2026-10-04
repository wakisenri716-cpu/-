import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { registerDevice, unregisterDevice } from "@/lib/push";

// スマホアプリが通知を受け取るための端末の登録 { token, platform: "ios" | "android" }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    await registerDevice(user.id, body);
    return { ok: true };
  }, 201);
}

// ログアウトしたら、この端末には送らない
export async function DELETE(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => unregisterDevice(user.id, body.token));
}
