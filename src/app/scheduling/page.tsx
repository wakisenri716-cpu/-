import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { prisma } from "@/lib/prisma";
import SchedulingView from "./SchedulingView";

export const dynamic = "force-dynamic";

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; id?: string }>;
}) {
  const companyId = await requireCompanyId();
  const q = await searchParams;
  const [ai, customers, vendors] = await Promise.all([
    aiEnabled(companyId),
    prisma.customer.findMany({
      where: { companyId },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.vendor.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const parties = [
    ...customers.map((c) => ({
      kind: "customer" as const,
      id: c.id,
      name: c.name,
      email: c.email,
    })),
    ...vendors.map((v) => ({
      kind: "vendor" as const,
      id: v.id,
      name: v.name,
      email: null,
    })),
  ];
  const initial =
    (q.kind === "customer" || q.kind === "vendor") &&
    q.id &&
    parties.some((p) => p.kind === q.kind && p.id === q.id)
      ? `${q.kind}:${q.id}`
      : "";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">日程調整</h1>
        <p className="mt-1 text-sm text-slate-600">
          取引先との打ち合わせの候補日時を、営業日(土日・祝日・年末年始と会社の休業日を除く)から出して、日程のご相談メールの下書きを作ります。自分のやることに打ち合わせ・訪問が入っている日は外します。候補は直せます。
          {ai
            ? "「AIで整える」を押すと、前置きと結びの言葉を用件に合わせて整えます(候補の日時は変えません)。"
            : ""}
        </p>
      </div>
      <SchedulingView parties={parties} initialParty={initial} ai={ai} />
    </div>
  );
}
