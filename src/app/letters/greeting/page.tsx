import Link from "next/link";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import { addressee, listAddressBook } from "@/lib/addressBook";
import { mailRecipients } from "@/lib/greetingMail";
import { prisma } from "@/lib/prisma";
import { GREETING_KINDS } from "@/lib/greetingLetters";
import { listClosures } from "@/lib/companyClosures";
import { closureNotice, groupClosures } from "@/lib/closureNotice";
import GreetingView from "./GreetingView";

export const dynamic = "force-dynamic";

export default async function GreetingPage({ searchParams }: { searchParams: Promise<{ closure?: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  // 会社の休業日から来たときは「休業のお知らせ」を入れておく
  const { closure } = await searchParams;
  let initial: { kind: "CLOSURE"; fields: Record<string, string> } | undefined;
  if (typeof closure === "string" && /^\d{4}-\d{2}-\d{2}$/.test(closure)) {
    const list = await listClosures(companyId);
    const group = groupClosures(list).find((g) => g.dates[0] === closure);
    if (group) {
      const n = closureNotice(group, new Map(list.map((c) => [c.date, c.name])));
      initial = { kind: "CLOSURE", fields: { name: n.name, period: n.period, restart: n.restartText } };
    }
  }
  const canSend = user.role === "ADMIN" || user.role === "ACCOUNTANT";
  const [parties, ai, recipients, company] = await Promise.all([
    listAddressBook(companyId),
    aiEnabled(companyId),
    canSend ? mailRecipients(companyId) : Promise.resolve([]),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, phone: true, address: true } }),
  ]);
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href="/letters" className="text-sm text-indigo-700 hover:underline">
          ← 宛名・送付状
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">挨拶状・お礼状</h1>
        <p className="mt-1 text-sm text-slate-600">
          お礼・年末年始や夏季休業などの休業・移転・担当者の交代・お詫び・新しい商品のご案内を、拝啓〜敬具の改まった形で作ります(時候の挨拶は日付の月に合わせます)。宛名は住所録から選べます。AIを使うと、会社の事情に合わせて本文を書き直します(日付・住所・電話番号は変えません)。A4で印刷・PDF保存できるほか、メールアドレスのある顧客に1社ずつ宛名を入れてメールでまとめて送れます(管理者・経理担当)。
        </p>
      </div>
      <GreetingView
        kinds={GREETING_KINDS}
        parties={parties.map((p) => ({ kind: p.kind, id: p.id, name: p.name }))}
        today={jstDateKey(new Date())}
        ai={ai}
        initial={initial}
        mail={canSend ? { recipients: recipients.map((r) => ({ id: r.id, name: r.name, email: r.email!, to: addressee(r) })), me: { company: company.name, phone: company.phone, address: company.address } } : null}
      />
    </div>
  );
}
