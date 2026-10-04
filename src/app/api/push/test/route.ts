import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { sendToUsers } from "@/lib/push";

// 自分のスマホにためしの通知を送る
export async function POST() {
  const user = await requireMember();
  return respond(async () => {
    const r = await sendToUsers([user.id], { title: "ためしの通知", body: "通知は届いています。シフトやマニュアルのお知らせがここに届きます", url: "/staff" });
    return { sent: r.sent, failed: r.failed, removed: r.removed, errors: r.errors };
  });
}
