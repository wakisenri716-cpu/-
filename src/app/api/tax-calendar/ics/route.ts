import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getTaxCalendar, toIcs } from "@/lib/taxCalendar";

// まだ済んでいない期限を .ics で(スマホ・PCのカレンダーに取り込む。3日前に通知)
export async function GET() {
  const companyId = await requireCompanyId();
  const [data, company] = await Promise.all([getTaxCalendar(companyId), prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })]);
  return new Response(toIcs(company.name, data.events), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="tax-calendar.ics"; filename*=UTF-8''${encodeURIComponent("税金・労務の期限.ics")}` },
  });
}
