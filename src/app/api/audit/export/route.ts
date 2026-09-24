import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { listAuditLogs } from "@/lib/audit";
import { csvResponse } from "@/lib/csv";

const TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export async function GET(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const { logs } = await listAuditLogs(admin.companyId, { action: new URL(request.url).searchParams.get("action"), take: 10_000 });
  const rows: (string | number)[][] = [["日時", "ユーザー", "操作", "内容"]];
  for (const l of logs) rows.push([TIME.format(l.createdAt), l.userName, l.action, l.detail ?? ""]);
  return csvResponse("操作ログ.csv", rows);
}
