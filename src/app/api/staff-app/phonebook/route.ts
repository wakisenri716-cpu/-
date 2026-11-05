import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listPhonebook } from "@/lib/phonebook";

// 従業員: 社内の電話帳を見る・探す
export async function GET(request: Request) {
  const user = await requireMember();
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  return respond(async () => {
    const d = await listPhonebook(user.companyId, q || undefined);
    return { count: d.count, groups: d.groups.map((g) => ({ department: g.department, entries: g.entries.map((e) => ({ id: e.id, name: e.name, extension: e.extension, direct: e.direct, mobile: e.mobile, note: e.note, me: e.userId === user.id })) })) };
  });
}
