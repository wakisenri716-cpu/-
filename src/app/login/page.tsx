import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { needsInitialSetup } from "@/lib/auth/setup";
import { LoginForm } from "./LoginForm";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const setup = await needsInitialSetup();
  // まだ誰も登録していなければ新規登録(最初の管理者と会社の情報)、あとはログイン
  return setup ? <SetupForm /> : <LoginForm />;
}
