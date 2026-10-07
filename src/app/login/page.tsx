import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { needsInitialSetup, signupOpen } from "@/lib/auth/setup";
import { LoginForm } from "./LoginForm";
import { SetupForm } from "./SetupForm";
import { AuthShell } from "./AuthShell";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const setup = await needsInitialSetup();
  // スマホアプリ(mobile/)ではアカウントを作らない(会社の管理者がパソコンで作る)
  const nativeApp = ((await headers()).get("user-agent") ?? "").includes("StaffAppNative");
  if (setup && nativeApp) {
    return (
      <div className="mx-auto max-w-sm space-y-3 py-16 text-center">
        <h1 className="text-xl font-semibold">まだ利用が始まっていません</h1>
        <p className="text-sm text-slate-600">会社の管理者がパソコンのブラウザで登録してから、Clerkly従業員用でログインしてください。</p>
      </div>
    );
  }
  // まだ誰も登録していなければ新規登録(最初の管理者と会社の情報)、あとはログイン
  return setup ? (
    <SetupForm />
  ) : (
    <AuthShell>
      <LoginForm signupOpen={signupOpen() && !nativeApp} />
    </AuthShell>
  );
}
