import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { requireAdmin } from "./session";

export const ROLES: UserRole[] = ["ADMIN", "ACCOUNTANT", "EMPLOYEE"];

export async function adminOr403() {
  const admin = await requireAdmin();
  return admin ?? NextResponse.json({ error: "この操作は管理者だけができます" }, { status: 403 });
}

export const PUBLIC_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  passwordHash: true,
} as const;

// パスワードのハッシュそのものは画面に渡さず、設定済みかどうかだけを返す
export function toPublicUser<T extends { passwordHash: string | null }>({ passwordHash, ...user }: T) {
  return { ...user, hasPassword: passwordHash !== null };
}
