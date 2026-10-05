import { requireCompanyId } from "@/lib/auth/session";
import { MatchView } from "./MatchView";

export const dynamic = "force-dynamic";

export default async function BankMatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const { id } = await params;
  return <MatchView id={id} />;
}
