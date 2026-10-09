import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";
import { announceClosure } from "@/lib/companyClosures";
import { notifyAnnouncement } from "@/lib/push/events";

// 会社の休業日を社内のお知らせに出す: { date: 休業のはじめの日, notify: メールでも知らせるか }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const { announcement, mailed, notice } = await announceClosure(user, body ?? {}, request);
    await audit("休業日を社内に知らせた", `${announcement.title}${mailed ? `(メール ${mailed}通)` : ""}`);
    notifyAnnouncement(user.companyId, user.id, announcement);
    return { id: announcement.id, title: announcement.title, mailed, notice };
  });
}
