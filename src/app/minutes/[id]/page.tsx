import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getMinutes } from "@/lib/minutes";
import { PrintButton } from "@/components/PrintButton";
import MinutesActions from "./MinutesActions";

export const dynamic = "force-dynamic";

const md = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const jp = (key: string) => `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;

export default async function MinutesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const m = await getMinutes(companyId, id);
  if (!m) notFound();
  const sections: [string, string[]][] = [
    ["議題", m.content.agenda],
    ["決まったこと", m.content.decisions],
    ["話し合ったこと", m.content.discussion],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/minutes" className="text-sm text-indigo-700 hover:underline">
          ← 議事録
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <MinutesActions id={m.id} posted={!!m.announcementId} actions={m.content.actions.length} />
          <PrintButton variant="outline" />
        </div>
      </div>
      <article className="mx-auto max-w-3xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-7 shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <h1 className="text-center text-xl font-semibold tracking-wide">{m.title}</h1>
        <dl className="grid grid-cols-[5rem_1fr] gap-y-1 border-y border-slate-200 py-3">
          <dt className="text-slate-500">日時</dt>
          <dd>{jp(m.heldOn)}</dd>
          {m.place && (
            <>
              <dt className="text-slate-500">場所</dt>
              <dd>{m.place}</dd>
            </>
          )}
          {m.attendees.length > 0 && (
            <>
              <dt className="text-slate-500">出席者</dt>
              <dd>{m.attendees.join("、")}</dd>
            </>
          )}
          <dt className="text-slate-500">記録</dt>
          <dd>{m.createdByName}</dd>
        </dl>
        {sections
          .filter(([, items]) => items.length)
          .map(([label, items]) => (
            <section key={label}>
              <h2 className="font-semibold">{label}</h2>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </section>
          ))}
        {m.content.actions.length > 0 && (
          <section>
            <h2 className="font-semibold">やること</h2>
            <table className="mt-1 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  <th className="border border-slate-300 px-2 py-1 font-medium">内容</th>
                  <th className="w-24 border border-slate-300 px-2 py-1 font-medium">担当</th>
                  <th className="w-20 border border-slate-300 px-2 py-1 font-medium">期限</th>
                </tr>
              </thead>
              <tbody>
                {m.content.actions.map((a, i) => (
                  <tr key={i} className="align-top">
                    <td className="border border-slate-300 px-2 py-1">{a.task}</td>
                    <td className="border border-slate-300 px-2 py-1">{a.owner ?? "−"}</td>
                    <td className="border border-slate-300 px-2 py-1 tabular-nums">{a.due ? md(a.due) : "−"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </article>
    </div>
  );
}
