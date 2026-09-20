import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

// Provisional (仮) login: no password, just a name + email that identifies
// who is acting. Good enough to try the app as "yourself" locally; swap for
// real auth (magic link, OAuth, etc.) before this is exposed beyond a laptop.
export const SESSION_COOKIE = "uid";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const uid = cookieStore.get(SESSION_COOKIE)?.value;
  if (!uid) return null;
  return prisma.user.findUnique({ where: { id: uid } });
}

export async function requireCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("ログインが必要です");
  return user.id;
}
