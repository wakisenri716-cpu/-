import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getMinutes } from "@/lib/minutes";
import { jstDateKey } from "@/lib/jst";
import MinutesEditor from "../../MinutesEditor";

export const dynamic = "force-dynamic";

export default async function EditMinutesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const m = await getMinutes(companyId, id);
  if (!m) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/minutes/${id}`} className="text-sm text-indigo-700 hover:underline">
          ← {m.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">議事録を直す</h1>
      </div>
      <MinutesEditor id={id} initial={{ title: m.title, heldOn: m.heldOn, place: m.place, attendees: m.attendees, content: m.content, mode: m.mode === "claude" ? "claude" : "template" }} initialNotes={m.notes} today={jstDateKey(new Date())} ai={false} />
    </div>
  );
}
