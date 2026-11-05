import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { myUpcomingShifts } from "@/lib/shiftRequests";
import { getLeaveOverview } from "@/lib/leave/service";
import { formatDays } from "@/lib/leave/rules";
import { unreadAnnouncements } from "@/lib/announcements";
import { mySupplyRequests, STATUS as SUPPLY_STATUS } from "@/lib/supplyRequests";
import { myEvents, ANSWERS as EVENT_ANSWERS, type Answer as EventAnswer } from "@/lib/companyEvents";
import { myHealth } from "@/lib/healthChecks";
import { mySurveys } from "@/lib/surveys";
import { mySeals, SEALS as SEAL_KINDS, STATUS as SEAL_STATUS } from "@/lib/sealUses";
import { myDuties } from "@/lib/duties";
import { searchLost } from "@/lib/lostItems";
import { myBento } from "@/lib/bento";
import { myCards, STATUS as CARD_STATUS } from "@/lib/cardOrders";
import { myNotices, KINDS as NOTICE_KINDS } from "@/lib/changeNotices";
import { myLendings } from "@/lib/lendings";
import { findPhone, phoneLines, phoneQuestion } from "@/lib/phonebook";
import { myChecks } from "@/lib/safetyChecks";

// 従業員向けのAIアシスタント: ログインしている本人のこと(シフト・有給・今月の勤務・経費精算・申請)と、
// 社内のマニュアル・お知らせについて答える。ほかの人や会社のお金のデータには触れない(道具が本人の分しか返さない)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const USER_DAILY_LIMIT = Number(process.env.STAFF_ASSISTANT_DAILY_LIMIT || 30);
const MAX_STEPS = 6;
const MAX_TURNS = 12;
const MAX_CHARS = 1000;
const DAY = 86_400_000;

export type StaffTurn = { role: "user" | "assistant"; text: string };
export type StaffReply = { reply: string; tools: string[]; mode: "claude" | "simple" };
type Me = { id: string; name: string; companyId: string };

const STATUS: Record<string, string> = { DRAFT: "作成中", SUBMITTED: "申請中", APPROVED: "承認済み", RETURNED: "差戻し", PENDING: "承認待ち", REJECTED: "差戻し", WITHDRAWN: "取下げ" };

async function staffOf(me: Me) {
  return prisma.staff.findFirst({ where: { companyId: me.companyId, userId: me.id, active: true } });
}

export const STAFF_TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "my_shifts", description: "自分のこれからのシフト(2週間分)を返す。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_leave", description: "自分の有給休暇の残り・次に付与される日と日数・時効が近い分・最近取った日を返す。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_attendance", description: "自分の今月(または指定した月)の出勤日数・働いた時間・退勤の打刻がない日を返す。", input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM(任意)" } }, additionalProperties: false } },
  { name: "my_expenses", description: "自分の経費精算(最近のもの)の状態・金額・差戻しの理由・精算(振込)済みかを返す。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_requests", description: "自分が出した申請(有給・購入など)の状態を返す。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "search_manuals", description: "社内のマニュアルを言葉で探し、合うものの題名と本文の抜き出しを返す。仕事のやり方・ルールの質問に使う。", input_schema: { type: "object", properties: { query: { type: "string", description: "探す言葉" } }, required: ["query"], additionalProperties: false } },
  { name: "my_notices", description: "まだ読んでいない社内のお知らせを返す。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_supplies", description: "自分が総務に頼んだ備品・消耗品の購入依頼(品物・数・状態〈依頼中・発注しました・届きました・見送り〉・見送りの理由)を返す。新しく頼むときは /staff/supplies を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_health", description: "自分の健康診断: 今年受けたか(受けた・予約済み・予約日を過ぎた・今年まだ・1年以上受けていない)・前に受けた日・予約日・再検査がまだかを返す(結果の中身は記録していない)。予約・受けたを入れるのは /staff/health を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_surveys", description: "受付中の社内アンケートの題・締め切り・問題の数・名前を出さないか・自分が答えたかを返す。答えるのは /staff/surveys を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_safety", description: "受付中の安否確認(災害のときの問いかけ・訓練)と、自分が答えたかを返す。答えるのは /staff/safety を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_seals", description: "自分が出した押印の申請(印・書類・部数・状態〈申請中・認められた・押した・見送り〉・見送りの理由)を返す。新しく頼むのは /staff/seals を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_duties", description: "自分のこれから2週間の当番(掃除・ゴミ出し・電話当番など)の日にちと、今日が当番かを返す。当番表は /staff/duties を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "find_lost_item", description: "社内の落とし物(あずかり中のもの)から、なくしたものに合いそうなものを探す。query になくしたもの(例: 黒い傘)を入れる。名のるのは /staff/lost を案内する。", input_schema: { type: "object", properties: { query: { type: "string", description: "なくしたもの" } }, required: ["query"], additionalProperties: false } },
  { name: "my_bento", description: "今日のお弁当: 頼めるお店とメニュー・締め切り・締め切ったか、自分が頼んだもの、今月の自分の合計とまだ払っていない金額を返す。頼むのは /staff/bento を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_paperwork", description: "自分の名刺の注文(枚数・状態)と、身上の変更の届け出(住所・電話・名前・緊急連絡先。状態と総務からの理由)を返す。名刺は /staff/cards、届け出は /staff/changes を案内する。引っ越しや結婚のときの手続きを聞かれたら、届け出を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "find_phone", description: "社内の電話帳(内線表)から、人・部署・場所(受付・会議室・倉庫など)の内線・直通・社用携帯を探す。query は名前の一部・部署・場所。「経理の内線は?」「山田さんの携帯は?」などに使う。一覧は /staff/phonebook を案内する。", input_schema: { type: "object", properties: { query: { type: "string", description: "名前・部署・場所" } }, required: ["query"], additionalProperties: false } },
  { name: "my_lendings", description: "総務から自分が借りているもの(鍵・入館証・ノートPCなど。貸した日・返す日・返す日を過ぎたか)と、この30日に返したものを返す。返すときは総務に直接渡すよう案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "my_events", description: "これからの社内のイベント(忘年会・歓迎会など)の日時・場所・会費・締め切りと、自分の出欠の答え(まだなら未回答)を返す。答えるのは /staff/events を案内する。", input_schema: { type: "object", properties: {}, additionalProperties: false } },
];

const minutesOf = (r: { clockIn: Date; clockOut: Date | null; breakMinutes: number }) => (r.clockOut ? Math.max(0, Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60_000) - r.breakMinutes) : 0);
const hm = (m: number) => `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`;

// 日本語の質問は空白で区切られないので、助詞・よくある言い回しで区切り、漢字・カタカナのまとまりも言葉として使う
export function manualKeywords(query: string) {
  const q = query.normalize("NFKC");
  const parts = q.split(/[\s、。・?!「」()]+|の|は|を|が|に|で|と|って|ですか|ますか|やり方|方法|どうやって|どうする|どう|教えて|知りたい|について/);
  const runs = q.match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu) ?? [];
  return [...new Set([...parts, ...runs].map((w) => w.trim()).filter((w) => w.length >= 2))].slice(0, 6);
}

export async function runStaffTool(me: Me, name: string, input: Record<string, unknown>): Promise<unknown> {
  const today = jstDateKey(new Date());
  switch (name) {
    case "my_shifts": {
      const r = await myUpcomingShifts(me.companyId, me.id, new Date(), 14);
      if (!r.staff) return { error: "スタッフとして登録されていません(管理者に「シフト管理」でのひも付けを頼んでください)" };
      return { shifts: r.shifts.map((s) => ({ date: s.date, weekday: s.weekday, time: `${s.start}〜${s.end}`, breakMinutes: s.breakMinutes, today: s.today })), link: "/staff/shifts" };
    }
    case "my_leave": {
      const staff = await staffOf(me);
      if (!staff) return { error: "スタッフとして登録されていないため、有給の記録がありません" };
      const o = (await getLeaveOverview(me.companyId)).staff.find((s) => s.id === staff.id);
      if (!o) return { error: "有給の記録がありません" };
      return {
        remaining: formatDays(o.balance),
        nextGrant: o.next ? { date: o.next.date, days: formatDays(o.next.halfDays) } : null,
        expiringSoon: o.expiring.map((e) => ({ days: formatDays(e.halfDays), expires: e.expires })),
        recentTaken: o.taken.slice(0, 5).map((t) => ({ date: t.date, days: formatDays(t.halfDays) })),
        mustTake: o.obligations.filter((x) => !x.met && !x.ended).map((x) => ({ deadline: x.deadline, used: formatDays(x.used), required: formatDays(x.required) })),
        howToApply: "有給は「申請・稟議」から申請します",
        link: "/requests",
      };
    }
    case "my_attendance": {
      const staff = await staffOf(me);
      if (!staff) return { error: "スタッフとして登録されていないため、勤務の記録がありません" };
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.month ?? "")) ? String(input.month) : today.slice(0, 7);
      const [y, m] = month.split("-").map(Number);
      const records = await prisma.timeRecord.findMany({ where: { staffId: staff.id, date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } }, orderBy: { date: "asc" } });
      const total = records.reduce((s, r) => s + minutesOf(r), 0);
      const open = records.filter((r) => !r.clockOut && jstDateKey(r.date) < today).map((r) => jstDateKey(r.date));
      return { month, days: new Set(records.map((r) => jstDateKey(r.date))).size, worked: hm(total), missingClockOut: open, note: open.length ? "退勤の打刻がない日は、管理者に直してもらってください" : null, link: "/timeclock" };
    }
    case "my_expenses": {
      const reports = await prisma.expenseReport.findMany({
        where: { companyId: me.companyId, employeeId: me.id, createdAt: { gte: new Date(Date.now() - 180 * DAY) } },
        include: { items: { select: { description: true, amount: true, receiptImageUrl: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return {
        reports: reports.map((r) => ({
          created: jstDateKey(r.createdAt),
          status: STATUS[r.approvalStatus] ?? r.approvalStatus,
          total: r.items.reduce((s, i) => s + i.amount, 0),
          items: r.items.length,
          withoutReceipt: r.items.filter((i) => !i.receiptImageUrl).map((i) => i.description).slice(0, 5),
          returnComment: r.returnComment,
          reimbursed: r.reimbursedAt ? jstDateKey(r.reimbursedAt) : null,
        })),
        link: "/expenses",
      };
    }
    case "my_requests": {
      const rs = await prisma.approvalRequest.findMany({ where: { companyId: me.companyId, requesterId: me.id }, orderBy: { createdAt: "desc" }, take: 10, select: { number: true, kind: true, title: true, status: true, createdAt: true, leaveDate: true } });
      return { requests: rs.map((r) => ({ number: r.number, title: r.title, status: STATUS[r.status] ?? r.status, created: jstDateKey(r.createdAt), leaveDate: r.leaveDate ? jstDateKey(r.leaveDate) : null })), link: "/requests" };
    }
    case "search_manuals": {
      const words = manualKeywords(String(input.query ?? ""));
      if (!words.length) return { manuals: [] };
      const manuals = await prisma.manual.findMany({ where: { companyId: me.companyId, published: true, OR: words.flatMap((w) => [{ title: { contains: w } }, { body: { contains: w } }]) }, select: { id: true, title: true, body: true }, take: 20 });
      const scored = manuals
        .map((x) => ({ ...x, score: words.reduce((s, w) => s + (x.title.includes(w) ? 3 : 0) + (x.body.includes(w) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return { manuals: scored.map((x) => ({ title: x.title, excerpt: x.body.slice(0, 800), link: `/staff/manuals/${x.id}` })) };
    }
    case "my_notices": {
      const r = await unreadAnnouncements(me);
      return { unread: r.count, latest: r.latest.map((n) => n.title), link: "/notices" };
    }
    case "my_supplies": {
      const rs = await mySupplyRequests(me);
      return { requests: rs.slice(0, 15).map((r) => ({ item: r.item, quantity: r.quantity, unit: r.unit, status: SUPPLY_STATUS[r.status as keyof typeof SUPPLY_STATUS] ?? r.status, reply: r.reply, requested: jstDateKey(r.createdAt) })), link: "/staff/supplies" };
    }
    case "my_health": {
      const h = await myHealth(me);
      if (!h.linked) return { linked: false, link: "/staff/health" };
      return { year: h.year, state: h.stateLabel, lastDone: h.lastDone, records: h.records.map((r) => ({ kind: r.kindLabel, plannedOn: r.plannedOn, doneOn: r.doneOn, followUpPending: r.followUp && !r.followUpDoneOn })), link: "/staff/health" };
    }
    case "my_surveys": {
      const ss = await mySurveys(me);
      return { surveys: ss.map((x) => ({ title: x.title, deadline: x.deadline, questions: x.questions.length, anonymous: x.anonymous, answered: !!x.mine })), link: "/staff/surveys" };
    }
    case "my_safety": {
      const cs = await myChecks(me);
      return { checks: cs.map((c) => ({ title: c.title, drill: c.drill, answered: !!c.mine })), link: "/staff/safety" };
    }
    case "my_seals": {
      const rs = await mySeals(me);
      return { requests: rs.slice(0, 10).map((r) => ({ seal: SEAL_KINDS[r.seal as keyof typeof SEAL_KINDS] ?? r.seal, document: r.document, copies: r.copies, status: SEAL_STATUS[r.status as keyof typeof SEAL_STATUS] ?? r.status, reply: r.reply })), link: "/staff/seals" };
    }
    case "find_lost_item": {
      const r = await searchLost(me, { query: String(input.query ?? ""), useAi: false });
      return { items: r.items.slice(0, 5).map((i) => ({ item: i.item, foundOn: i.foundOn, place: i.place, keptAt: i.keptAt })), link: "/staff/lost" };
    }
    case "my_bento": {
      const b = await myBento(me);
      return { date: b.date, shops: b.shops.map((s) => ({ name: s.name, cutoff: s.cutoff, closed: s.closed, menu: s.menu.map((m) => `${m.name} ${m.price}円`) })), mine: b.mine.map((o) => `${o.itemName}×${o.qty}`), monthTotal: b.monthTotal, monthUnpaid: b.monthUnpaid, link: "/staff/bento" };
    }
    case "my_paperwork": {
      const [cards, notices] = await Promise.all([myCards(me), myNotices(me)]);
      const NS: Record<string, string> = { REQUESTED: "総務の確認待ち", APPLIED: "名簿に入りました", REJECTED: "確かめが必要" };
      return { cards: cards.orders.slice(0, 5).map((o) => ({ quantity: o.quantity, status: CARD_STATUS[o.status as keyof typeof CARD_STATUS] ?? o.status })), notices: notices.slice(0, 5).map((n) => ({ kind: NOTICE_KINDS[n.kind as keyof typeof NOTICE_KINDS] ?? n.kind, status: NS[n.status] ?? n.status, reply: n.reply })), links: { cards: "/staff/cards", changes: "/staff/changes" } };
    }
    case "find_phone": {
      const q = typeof input.query === "string" ? input.query.trim().slice(0, 40) : "";
      const rows = q ? await findPhone(me.companyId, q) : [];
      return { query: q, entries: rows.map((r) => ({ name: r.name, department: r.department, extension: r.extension, direct: r.direct, mobile: r.mobile, note: r.note })), link: "/staff/phonebook" };
    }
    case "my_lendings": {
      const ls = await myLendings(me);
      return { borrowing: ls.filter((l) => !l.returnedOn).map((l) => ({ item: l.item, lentOn: l.lentOn, dueOn: l.dueOn, overdue: l.overdue })), returned: ls.filter((l) => l.returnedOn).map((l) => ({ item: l.item, returnedOn: l.returnedOn })) };
    }
    case "my_duties": {
      const ds = await myDuties(me);
      return { duties: ds.map((d) => ({ role: d.role, date: d.date, today: d.today, note: d.note })), link: "/staff/duties" };
    }
    case "my_events": {
      const es = await myEvents(me);
      return { events: es.map((e) => ({ title: e.title, date: e.date, time: e.time, place: e.place, fee: e.fee, deadline: e.deadline, closed: e.closed, myAnswer: e.mine ? EVENT_ANSWERS[e.mine.answer as EventAnswer] : "未回答", paid: e.mine?.paid ?? false })), link: "/staff/events" };
    }
    default:
      throw new UserError("その道具はありません");
  }
}

function systemPrompt(companyName: string, name: string) {
  return [
    `あなたは「${companyName}」で働く ${name} さんを手伝うAIアシスタントです。やさしい日本語で、結論から短く答えてください。`,
    "答えられるのは、本人のシフト・有給・勤務時間・経費精算・申請と、社内のマニュアル・お知らせのことだけです。必ず道具で調べてから答え、データにないことは推測しないでください。",
    "ほかの人の情報・給料の額・会社のお金のことは答えられないので、管理者に聞くよう伝えてください。仕事のやり方の質問はマニュアルを探し、見つからなければ管理者に聞くよう伝えてください。",
    "関係する画面があれば、答えの最後に道具の結果の link を [画面の名前](/パス) の形でつけてください。",
  ].join("\n");
}

async function askClaude(client: Anthropic, me: Me, companyName: string, history: StaffTurn[]): Promise<StaffReply> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: "user", content: `${last.content as string}\n\n(今日は ${jstDateKey(new Date())} です)` };
  const used: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: systemPrompt(companyName, me.name), cache_control: { type: "ephemeral" } }],
      tools: STAFF_TOOLS,
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return { reply: "すみません、この質問にはお答えできません。", tools: used, mode: "claude" };
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !calls.length) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text || "うまく答えられませんでした。もう一度聞いてください。", tools: used, mode: "claude" };
    }
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        used.push(call.name);
        try {
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(await runStaffTool(me, call.name, (call.input ?? {}) as Record<string, unknown>)) };
        } catch (error) {
          return { type: "tool_result", tool_use_id: call.id, content: error instanceof Error ? error.message : "調べられませんでした", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { reply: "調べることが多すぎて、まとめられませんでした。質問を分けてお試しください。", tools: used, mode: "claude" };
}

// APIキーがないとき: 言葉の手がかりで道具を1つ選んで答える
async function askSimple(me: Me, q: string): Promise<StaffReply> {
  const s = q.normalize("NFKC");
  const run = (name: string, input: Record<string, unknown> = {}) => runStaffTool(me, name, input) as Promise<Record<string, unknown>>;
  const err = (r: Record<string, unknown>) => (typeof r.error === "string" ? r.error : null);
  if (/有給|休暇|休み.*(残|何日)/.test(s)) {
    const r = await run("my_leave");
    if (err(r)) return { reply: err(r)!, tools: ["my_leave"], mode: "simple" };
    const next = r.nextGrant as { date: string; days: string } | null;
    return { reply: [`有給の残りは ${r.remaining} です。`, next ? `次は ${next.date} に ${next.days} 付与されます。` : "", "[申請・稟議](/requests)"].filter(Boolean).join("\n"), tools: ["my_leave"], mode: "simple" };
  }
  if (/シフト|出勤日|次の出勤|いつ働/.test(s)) {
    const r = await run("my_shifts");
    if (err(r)) return { reply: err(r)!, tools: ["my_shifts"], mode: "simple" };
    const shifts = r.shifts as { date: string; weekday: string; time: string }[];
    return { reply: shifts.length ? ["これからのシフト:", ...shifts.slice(0, 7).map((x) => `・${x.date.slice(5)}(${x.weekday}) ${x.time}`), "[シフト](/staff/shifts)"].join("\n") : "これからのシフトはまだ入っていません。\n[シフト](/staff/shifts)", tools: ["my_shifts"], mode: "simple" };
  }
  if (/勤務|働いた|労働時間|何時間|打刻/.test(s)) {
    const r = await run("my_attendance");
    if (err(r)) return { reply: err(r)!, tools: ["my_attendance"], mode: "simple" };
    const open = r.missingClockOut as string[];
    return { reply: [`${r.month} は ${r.days}日・${r.worked} 働いています。`, open.length ? `退勤の打刻がない日があります(${open.join("、")})。管理者に直してもらってください。` : "", "[タイムカード](/timeclock)"].filter(Boolean).join("\n"), tools: ["my_attendance"], mode: "simple" };
  }
  if (/経費|精算|立替|立て替/.test(s)) {
    const r = await run("my_expenses");
    const reports = r.reports as { created: string; status: string; total: number; reimbursed: string | null; returnComment: string | null }[];
    if (!reports.length) return { reply: "最近の経費精算はありません。\n[経費精算](/expenses)", tools: ["my_expenses"], mode: "simple" };
    return { reply: ["最近の経費精算:", ...reports.slice(0, 5).map((x) => `・${x.created} ${formatYen(x.total)}(${x.status}${x.reimbursed ? `・${x.reimbursed} に精算済み` : ""}${x.returnComment ? `・差戻しの理由: ${x.returnComment}` : ""})`), "[経費精算](/expenses)"].join("\n"), tools: ["my_expenses"], mode: "simple" };
  }
  if (/購入依頼|備品|消耗品|頼んだ(もの|物)|発注/.test(s)) {
    const r = await run("my_supplies");
    const rs = r.requests as { item: string; quantity: number; unit: string | null; status: string; reply: string | null }[];
    return { reply: rs.length ? ["あなたの購入依頼:", ...rs.slice(0, 8).map((x) => `・${x.item} ${x.quantity}${x.unit ?? ""}(${x.status}${x.reply ? `・${x.reply}` : ""})`), "[購入依頼](/staff/supplies)"].join("\n") : "頼んだものはありません。ほしいものは [購入依頼](/staff/supplies) から頼めます。", tools: ["my_supplies"], mode: "simple" };
  }
  if (/落とし物|忘れ物|落し物|なくし|失くし|無くし|落とし|置き忘れ/.test(s)) {
    const query = s.replace(/(を|が)?(なくし|失くし|無くし|落とし|忘れ|置き忘れ)(て|た|ました|ちゃった)?.*$/, "").replace(/落とし物|忘れ物|落し物|ありますか|ない|[?？]/g, "").trim().replace(/[のをが]+$/, "");
    if (!query) return { reply: "なくしたものを教えてください(例: 黒い傘をなくした)。落とし物の一覧は [落とし物・忘れ物](/staff/lost) で見られます。", tools: [], mode: "simple" };
    const r = await run("find_lost_item", { query });
    const items = r.items as { item: string; foundOn: string; place: string | null; keptAt: string | null }[];
    return { reply: items.length ? [`「${query}」に合いそうな落とし物:`, ...items.map((i) => `・${i.item}(${Number(i.foundOn.slice(5, 7))}/${Number(i.foundOn.slice(8))}${i.place ? `・${i.place}` : ""}${i.keptAt ? `・${i.keptAt}であずかり中` : ""})`), "自分のものなら [落とし物・忘れ物](/staff/lost) で「わたしのです」を押してください。"].join("\n") : `「${query}」に合いそうな落とし物はまだありません。[落とし物・忘れ物](/staff/lost) で一覧も見られます。`, tools: ["find_lost_item"], mode: "simple" };
  }
  if (/名刺|引っ越|引越|転居|住所(が|を)?変|電話番号(が|を)?変|結婚|改姓|旧姓|緊急連絡先|届け出|届出/.test(s)) {
    const r = await run("my_paperwork");
    const cards = r.cards as { quantity: number; status: string }[];
    const notices = r.notices as { kind: string; status: string; reply: string | null }[];
    const wantsCard = /名刺/.test(s);
    return {
      reply: [
        wantsCard ? (cards.length ? `名刺: ${cards.map((c) => `${c.quantity}枚(${c.status})`).join("、")}` : "名刺の注文はまだありません。") : notices.length ? `届け出: ${notices.map((n) => `${n.kind}(${n.status}${n.reply ? `・${n.reply}` : ""})`).join("、")}` : "引っ越し・電話番号・名前・緊急連絡先が変わったら、届け出てください。",
        wantsCard ? "[名刺の注文](/staff/cards) から申し込めます。" : "[身上の変更の届け出](/staff/changes) から届け出られます(給与の振込先の口座は総務に直接伝えてください)。",
      ].join("\n"),
      tools: ["my_paperwork"],
      mode: "simple",
    };
  }
  const phoneQ = phoneQuestion(s);
  if (phoneQ !== null) {
    if (!phoneQ) return { reply: "だれ(どこ)の番号か教えてください(例: 経理の内線は?)。一覧は [社内の電話帳](/staff/phonebook) にあります。", tools: [], mode: "simple" };
    const r = await run("find_phone", { query: phoneQ });
    const entries = (r.entries ?? []) as Parameters<typeof phoneLines>[0];
    return { reply: [entries.length ? `「${phoneQ}」の番号:` : `電話帳に「${phoneQ}」は見つかりませんでした。総務に聞いてください。`, ...phoneLines(entries), "[社内の電話帳](/staff/phonebook)"].join("\n"), tools: ["find_phone"], mode: "simple" };
  }
  if (/借りて(い|る)|借りたもの|借りてる|返すもの|返し忘れ|貸してもらって/.test(s)) {
    const r = await run("my_lendings");
    const b = r.borrowing as { item: string; dueOn: string | null; overdue: boolean }[];
    const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`;
    return {
      reply: b.length ? [`いま総務から借りているもの:`, ...b.map((x) => `・${x.item}${x.dueOn ? `(${md(x.dueOn)}まで${x.overdue ? "・返す日を過ぎています" : ""})` : ""}`), "返すときは総務に直接渡してください。"].join("\n") : "いま総務から借りているものはありません。",
      tools: ["my_lendings"],
      mode: "simple",
    };
  }
  if (/弁当/.test(s)) {
    const r = await run("my_bento");
    const shops = r.shops as { name: string; cutoff: string; closed: boolean }[];
    const mine = r.mine as string[];
    return {
      reply: [mine.length ? `今日頼んだお弁当: ${mine.join("、")}` : "今日はまだお弁当を頼んでいません。", ...shops.map((x) => `・${x.name}: ${x.closed ? "締め切りました" : `${x.cutoff}まで頼めます`}`), `今月の合計 ${Number(r.monthTotal).toLocaleString()}円${Number(r.monthUnpaid) ? `(まだ払っていない ${Number(r.monthUnpaid).toLocaleString()}円)` : ""}`, "[お弁当の注文](/staff/bento)"].join("\n"),
      tools: ["my_bento"],
      mode: "simple",
    };
  }
  if (/当番/.test(s)) {
    const r = await run("my_duties");
    const ds = r.duties as { role: string; date: string; today: boolean }[];
    return { reply: ds.length ? ["あなたの当番(2週間):", ...ds.map((d) => `・${d.today ? "今日 " : ""}${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))} ${d.role}`), "[当番表](/staff/duties)"].join("\n") : "これから2週間、あなたの当番はありません。\n[当番表](/staff/duties)", tools: ["my_duties"], mode: "simple" };
  }
  if (/押印|実印|銀行印|角印|印鑑|ハンコ|はんこ/.test(s)) {
    const r = await run("my_seals");
    const rs = r.requests as { seal: string; document: string; copies: number; status: string; reply: string | null }[];
    return { reply: rs.length ? ["あなたの押印の申請:", ...rs.slice(0, 6).map((x) => `・${x.document}(${x.seal}・${x.copies}部) — ${x.status}${x.reply ? `・${x.reply}` : ""}`), "新しく頼むのは [押印の申請](/staff/seals) からです。"].join("\n") : "押印の申請はまだありません。[押印の申請](/staff/seals) から頼めます。", tools: ["my_seals"], mode: "simple" };
  }
  if (/安否/.test(s)) {
    const r = await run("my_safety");
    const cs = r.checks as { title: string; drill: boolean; answered: boolean }[];
    return { reply: cs.length ? [...cs.map((c) => `・${c.drill ? "(訓練)" : ""}${c.title} — ${c.answered ? "答えました" : "まだ答えていません"}`), "[安否確認](/staff/safety) から答えられます。"].join("\n") : "いま答える安否確認はありません。", tools: ["my_safety"], mode: "simple" };
  }
  if (/アンケート/.test(s)) {
    const r = await run("my_surveys");
    const ss = r.surveys as { title: string; deadline: string | null; questions: number; answered: boolean }[];
    return { reply: ss.length ? [...ss.map((x) => `・${x.title}(${x.questions}問${x.deadline ? `・${Number(x.deadline.slice(5, 7))}/${Number(x.deadline.slice(8))}まで` : ""}) — ${x.answered ? "答えました" : "まだ答えていません"}`), "[社内アンケート](/staff/surveys) から答えられます。"].join("\n") : "いま答えるアンケートはありません。", tools: ["my_surveys"], mode: "simple" };
  }
  if (/健康診断|健診|再検査|精密検査|ストレスチェック/.test(s)) {
    const r = await run("my_health");
    if (r.linked === false) return { reply: "あなたのスタッフ登録が見つかりません。総務に、ログインとスタッフのひも付けを頼んでください。", tools: ["my_health"], mode: "simple" };
    const recs = r.records as { kind: string; plannedOn: string | null; doneOn: string | null; followUpPending: boolean }[];
    const plan = recs.find((x) => !x.doneOn && x.plannedOn);
    return {
      reply: [`${r.year}年の健康診断: ${r.state}${plan ? `(予約 ${plan.plannedOn!.slice(5).replace("-", "/")})` : ""}`, r.lastDone ? `前に受けた日: ${String(r.lastDone).replace(/-/g, "/")}` : "", recs.some((x) => x.followUpPending) ? "再検査をまだ受けていません。受けたら知らせてください。" : "", "予約した・受けたは [健康診断](/staff/health) から総務に伝えられます。"].filter(Boolean).join("\n"),
      tools: ["my_health"],
      mode: "simple",
    };
  }
  if (/イベント|忘年会|新年会|歓迎会|送別会|飲み会|社員旅行|出欠/.test(s)) {
    const r = await run("my_events");
    const es = r.events as { title: string; date: string; time: string | null; place: string | null; deadline: string | null; closed: boolean; myAnswer: string }[];
    return { reply: es.length ? ["これからの社内のイベント:", ...es.map((e) => `・${e.title} ${e.date.slice(5).replace("-", "/")}${e.time ? ` ${e.time}` : ""}${e.place ? `・${e.place}` : ""} — あなたの答え: ${e.myAnswer}${!e.closed && e.myAnswer === "未回答" && e.deadline ? `(締め切り ${e.deadline.slice(5).replace("-", "/")})` : ""}`), "[社内のイベント](/staff/events)"].join("\n") : "これからの社内のイベントはありません。", tools: ["my_events"], mode: "simple" };
  }
  if (/申請|稟議|承認/.test(s)) {
    const r = await run("my_requests");
    const rs = r.requests as { number: string; title: string; status: string }[];
    return { reply: rs.length ? ["あなたの申請:", ...rs.slice(0, 5).map((x) => `・${x.number} ${x.title}(${x.status})`), "[申請・稟議](/requests)"].join("\n") : "出した申請はありません。\n[申請・稟議](/requests)", tools: ["my_requests"], mode: "simple" };
  }
  if (/お知らせ|連絡/.test(s)) {
    const r = await run("my_notices");
    return { reply: Number(r.unread) ? [`まだ読んでいないお知らせが ${r.unread}件 あります:`, ...(r.latest as string[]).map((t) => `・${t}`), "[社内のお知らせ](/notices)"].join("\n") : "まだ読んでいないお知らせはありません。", tools: ["my_notices"], mode: "simple" };
  }
  const r = await run("search_manuals", { query: s });
  const ms = r.manuals as { title: string; excerpt: string; link: string }[];
  if (ms.length) return { reply: ["マニュアルにこんなものがあります:", ...ms.map((x) => `・[${x.title}](${x.link})`)].join("\n"), tools: ["search_manuals"], mode: "simple" };
  return { reply: "いまは簡易モードのため、「有給は何日残ってる?」「次のシフトは?」「今月何時間働いた?」「経費精算はどうなった?」「申請の状況は?」や、マニュアルの言葉で聞いてください。", tools: [], mode: "simple" };
}

export async function askStaffAssistant(me: Me, input: unknown): Promise<StaffReply> {
  const history: StaffTurn[] = (Array.isArray(input) ? input : [])
    .filter((t): t is StaffTurn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim() !== "")
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }));
  while (history.length && history[0].role !== "user") history.shift();
  const question = history[history.length - 1];
  if (!question || question.role !== "user") throw new UserError("質問を入力してください");
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  const [companyCount, userCount] = await Promise.all([
    prisma.assistantLog.count({ where: { companyId: me.companyId, createdAt: { gte: since } } }),
    prisma.assistantLog.count({ where: { companyId: me.companyId, userId: me.id, createdAt: { gte: since } } }),
  ]);
  if (companyCount >= DAILY_LIMIT || userCount >= USER_DAILY_LIMIT) throw new UserError("今日のAIへの質問の回数が上限になりました。明日またお試しください");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: me.companyId }, select: { name: true } });
  let result: StaffReply;
  const client = await aiFor(me.companyId);
  if (client) {
    try {
      result = await askClaude(client, me, company.name, history);
    } catch (error) {
      if (error instanceof Anthropic.APIError) throw new UserError("AIに問い合わせできませんでした。時間をおいてお試しください");
      throw error;
    }
  } else {
    result = await askSimple(me, question.text);
  }
  await prisma.assistantLog.create({ data: { companyId: me.companyId, userId: me.id, question: question.text.slice(0, 500), tools: result.tools, mode: `staff-${result.mode}` } });
  return result;
}
