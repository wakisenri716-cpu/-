import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myUpcomingShifts } from "@/lib/shiftRequests";
import { countUnreadManuals } from "@/lib/manuals";
import { unreadAnnouncements } from "@/lib/announcements";
import { listStock } from "@/lib/staffInventory";
import { myEvents } from "@/lib/companyEvents";
import { countUnseenAnswers } from "@/lib/staffQuestions";
import { myChecks } from "@/lib/safetyChecks";
import { countUnansweredSurveys } from "@/lib/surveys";
import { myDuties, mySwapRequests } from "@/lib/duties";
import { myLendings } from "@/lib/lendings";

// Clerkly従業員用のホーム: これからのシフト・未読のマニュアルとお知らせ・在庫が少ない商品の数・出欠を答えていないイベント・総務からの新しい答え
export async function GET() {
  const user = await requireMember();
  return respond(async () => {
    const [upcoming, unreadManuals, notices, stock, events, newAnswers, safety, surveys, duties, swaps, lendings] = await Promise.all([
      myUpcomingShifts(user.companyId, user.id),
      countUnreadManuals(user.companyId, user.id),
      unreadAnnouncements(user),
      listStock(user.companyId),
      myEvents(user),
      countUnseenAnswers(user),
      myChecks(user),
      countUnansweredSurveys(user),
      myDuties(user),
      mySwapRequests(user),
      myLendings(user),
    ]);
    // まだ出欠を答えていない、受付中のイベント
    const toAnswer = events.filter((e) => !e.closed && !e.mine).map((e) => ({ id: e.id, title: e.title, date: e.date, deadline: e.deadline }));
    return { name: user.name, ...upcoming, unreadManuals, unreadNotices: notices.count, latestNotices: notices.latest, lowStock: stock.low, hasProducts: stock.products.length > 0, toAnswer, newAnswers, safety: safety.map((c) => ({ id: c.id, title: c.title, answered: !!c.mine })), surveys, dutiesToday: duties.filter((d) => d.today).map((d) => d.role), swapAsks: swaps.incoming.length, lendingsDue: lendings.filter((l) => l.overdue || l.dueToday).map((l) => ({ item: l.item, dueOn: l.dueOn, overdue: l.overdue })) };
  });
}
