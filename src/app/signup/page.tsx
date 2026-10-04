import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { needsInitialSetup, signupOpen } from "@/lib/auth/setup";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { SetupForm } from "../login/SetupForm";

export const dynamic = "force-dynamic";

// 新しい会社の登録(サービスとして公開しているとき)
export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");
  if (await needsInitialSetup()) redirect("/login");
  const nativeApp = ((await headers()).get("user-agent") ?? "").includes("StaffAppNative");
  if (!signupOpen() || nativeApp) {
    return (
      <div className="mx-auto max-w-sm space-y-3 py-16 text-center">
        <h1 className="text-xl font-semibold">新規登録</h1>
        <p className="text-sm text-slate-600">{nativeApp ? "新規登録は、パソコンなどのブラウザで行ってください。" : "現在、新規登録は受け付けていません。"}</p>
        <Link href="/login" className="text-sm text-indigo-700 hover:underline">
          ログイン画面へ
        </Link>
      </div>
    );
  }
  return <SetupForm endpoint="/api/auth/signup" trialDays={TRIAL_DAYS} />;
}
