import { requireMember } from "@/lib/auth/session";
import { TravelView } from "./TravelView";

export const dynamic = "force-dynamic";

export default async function TravelPage() {
  await requireMember();
  return <TravelView />;
}
