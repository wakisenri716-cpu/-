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
