import Link from "next/link";
import { checkResetToken } from "@/lib/auth/passwordReset";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const reset = token ? await checkResetToken(token) : null;

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-xl font-semibold">新しいパスワードを決める</h1>
      {reset && token ? (
        <ResetForm token={token} name={reset.user.name} />
      ) : (
        <div className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
          <p>このリンクは使えません。期限(1時間)が切れたか、すでに使われています。</p>
          <Link href="/forgot-password" className="inline-block text-indigo-700 hover:underline">
            もう一度、再設定のメールを送る
          </Link>
        </div>
      )}
    </div>
  );
}
