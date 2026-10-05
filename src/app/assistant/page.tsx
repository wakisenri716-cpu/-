import { requireCompanyId } from "@/lib/auth/session";
import { AssistantChat } from "./AssistantChat";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireCompanyId();
  const { q } = await searchParams;
  return <AssistantChat initialQuestion={(q ?? "").slice(0, 500)} aiEnabled={!!process.env.ANTHROPIC_API_KEY} />;
}
