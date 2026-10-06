import Link from "next/link";
import { verifyEmail } from "@/lib/auth/emailVerification";

export const dynamic = "force-dynamic";

// メールのリンクを開いたところ(ログインしていなくても開ける)
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const result = await verifyEmail((await searchParams).token);
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      {result ? (
        <>
          <h1 className="text-xl font-semibold">メールアドレスを確認しました</h1>
          <p className="text-sm text-slate-600">{result.already ? "このメールアドレスは確認済みです。" : `${result.name}さん、ありがとうございます。すべての機能をお使いいただけます。`}</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">このリンクは使えません</h1>
          <p className="text-sm text-slate-600">期限(24時間)が切れているか、正しくないリンクです。ログインして、画面の上の「確認のメールをもう一度送る」を押してください。</p>
        </>
      )}
      <Link href="/" className="inline-block rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700">
        Clerkly を開く
      </Link>
    </div>
  );
}
