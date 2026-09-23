import { requireUser } from "@/lib/auth/session";
import { UsersManager } from "./UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">ユーザー管理</h1>
        <p className="text-sm text-slate-600">この画面は管理者だけが使えます。</p>
      </div>
    );
  }
  return <UsersManager currentUserId={user.id} />;
}
