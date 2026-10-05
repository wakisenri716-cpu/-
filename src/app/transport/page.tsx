import { requireMember } from "@/lib/auth/session";
import { TransportView } from "./TransportView";

export const dynamic = "force-dynamic";

export default async function TransportPage() {
  await requireMember();
  return <TransportView />;
}
