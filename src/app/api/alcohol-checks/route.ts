import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { csvResponse } from "@/lib/csv";
import { jstDateKey } from "@/lib/jst";
import { checksCsv, listChecks, recordCheck, TIMINGS, type Timing } from "@/lib/alcoholChecks";
import { audit } from "@/lib/audit";

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};

// ?month=YYYY-MM(既定は今月)、&format=csv で記録簿のCSV
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const url = new URL(request.url);
  const raw = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : jstDateKey(new Date()).slice(0, 7);
  const { from, to } = monthRange(month);
  const rows = await listChecks(companyId, from, to);
  if (url.searchParams.get("format") === "csv") return csvResponse(`アルコールチェック記録簿_${month}.csv`, checksCsv(rows));
  return respond(async () => ({ month, checks: rows }));
}

// 記録する: { bookingId?, timing, driverId?, driverName?, vehicle?, method, value, detected, note, date }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const check = await recordCheck(user, body ?? {});
    await audit("アルコールチェックを記録", `${check.date} ${TIMINGS[check.timing as Timing]} ${check.driverName} ${check.vehicle} 酒気帯び${check.detected ? "あり" : "なし"}`);
    return { check };
  }, 201);
}
