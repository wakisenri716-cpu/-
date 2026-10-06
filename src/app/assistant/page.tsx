import { requireCompanyId } from "@/lib/auth/session";
import { AssistantChat } from "./AssistantChat";
import { aiEnabled } from "@/lib/ai/access";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const companyId = await requireCompanyId();
  const { q } = await searchParams;
  return <AssistantChat initialQuestion={(q ?? "").slice(0, 500)} aiEnabled={await aiEnabled(companyId)} />;
}
