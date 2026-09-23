import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { needsInitialSetup, setupSecretRequired } from "@/lib/auth/setup";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const setup = await needsInitialSetup();
  return <LoginForm mode={setup ? "setup" : "login"} secretRequired={setup && setupSecretRequired()} />;
}
