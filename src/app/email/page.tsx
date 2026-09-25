import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { EmailSettings } from "./EmailSettings";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  await requireCompanyId();
  const user = await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">メール設定・送信履歴</h1>
        <p className="mt-1 text-sm text-slate-600">
          請求書・見積書・督促のメール送付、パスワード再設定のメール、毎朝の「やること」のお知らせに使います。送ったメールはすべて下の履歴に残ります。
        </p>
      </div>
      <EmailSettings isAdmin={user.role === "ADMIN"} defaultTo={user.email} />
    </div>
  );
}
