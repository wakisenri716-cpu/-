import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myUpcomingShifts } from "@/lib/shiftRequests";
import { countUnreadManuals } from "@/lib/manuals";
import { unreadAnnouncements } from "@/lib/announcements";
import { listStock } from "@/lib/staffInventory";

// Clerkly従業員用のホーム: これからのシフト・未読のマニュアルとお知らせ・在庫が少ない商品の数
export async function GET() {
  const user = await requireMember();
  return respond(async () => {
    const [upcoming, unreadManuals, notices, stock] = await Promise.all([
      myUpcomingShifts(user.companyId, user.id),
      countUnreadManuals(user.companyId, user.id),
      unreadAnnouncements(user),
      listStock(user.companyId),
    ]);
    return { name: user.name, ...upcoming, unreadManuals, unreadNotices: notices.count, latestNotices: notices.latest, lowStock: stock.low, hasProducts: stock.products.length > 0 };
  });
}
