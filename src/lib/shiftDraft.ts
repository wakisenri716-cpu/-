import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { dailyPay, parseTime } from "@/lib/shifts/pay";
import { addMonth, breakFor, daysOf, hhmm, monthDateRange, parseMonth } from "@/lib/shiftRequests";

// シフトの自動作成: 曜日ごとの必要な人数・時間帯と、スタッフのシフト希望(出られる日・時間・休み)から、
// 1か月分のシフトの下書きを決まったルールで作る。
// ・すでに入っているシフトは人数に数え、そのまま残す
// ・休みの希望の日には入れない。週(月〜日)の勤務日数はスタッフの「週の所定労働日数」まで
// ・入れる人は、希望を出した人 → これまでに入った日数が少ない人 → 時給の低い人の順
// 人件費の見込み(直近3か月の売上の平均に対する割合)も出す。AIが使えるときは、偏り・足りない日・人件費の見立てを書く。
// 下書きは保存せず、人が「このシフトで作る」を押したときにシフトを作る。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const WEEKDAYS = "日月火水木金土";
const DAY = 86_400_000;

export type Need = { count: number; start: string; end: string };
export type DraftShift = { staffId: string; name: string; date: string; start: string; end: string; breakMinutes: number; requested: boolean; pay: number };

// 直近4週のシフトから、曜日ごとの人数といちばん多い時間帯を出す(必要な人数の初期値)
export async function suggestNeeds(companyId: string, now = new Date()): Promise<Need[]> {
  const to = new Date(`${jstDateKey(now)}T00:00:00Z`);
  const from = new Date(to.getTime() - 28 * DAY);
  const shifts = await prisma.shift.findMany({ where: { companyId, date: { gte: from, lt: to } }, select: { date: true, startMinutes: true, endMinutes: true } });
  return Array.from({ length: 7 }, (_, wd) => {
    const mine = shifts.filter((s) => s.date.getUTCDay() === wd);
    const days = new Set(mine.map((s) => s.date.toISOString().slice(0, 10))).size;
    const times = new Map<string, number>();
    for (const s of mine) times.set(`${s.startMinutes}-${s.endMinutes}`, (times.get(`${s.startMinutes}-${s.endMinutes}`) ?? 0) + 1);
    const top = [...times.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const [st, en] = top ? top.split("-").map(Number) : [10 * 60, 18 * 60];
    return { count: days ? Math.round(mine.length / days) : 0, start: hhmm(st), end: hhmm(en) };
  });
}

export function parseNeeds(input: unknown): Need[] {
  if (!Array.isArray(input) || input.length !== 7) throw new UserError("曜日ごとの必要な人数を入れてください");
  return input.map((x, i) => {
    const v = (x ?? {}) as Record<string, unknown>;
    const count = Number(v.count ?? 0);
    if (!Number.isInteger(count) || count < 0 || count > 50) throw new UserError(`${WEEKDAYS[i]}曜日の人数は0〜50で入れてください`);
    const start = parseTime(String(v.start ?? ""));
    const end = parseTime(String(v.end ?? ""));
    if (count > 0 && (start === null || end === null || end <= start)) throw new UserError(`${WEEKDAYS[i]}曜日の時間帯を正しく入れてください(例: 10:00〜18:00)`);
    return { count, start: start === null ? "10:00" : hhmm(start), end: end === null ? "18:00" : hhmm(end) };
  });
}

// 月曜はじまりの週のキー
const weekOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

async function averageRevenue(companyId: string, now: Date) {
  const thisMonth = jstDateKey(now).slice(0, 7);
  const from = addMonth(thisMonth, -3);
  const lines = await prisma.journalLine.findMany({
    where: { account: { category: "REVENUE" }, journalEntry: { companyId, status: { in: [...POSTED] }, sourceType: { not: "OPENING" }, date: { gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${thisMonth}-01T00:00:00Z`) } } },
    select: { debit: true, credit: true },
  });
  return Math.round(lines.reduce((s, l) => s + l.credit - l.debit, 0) / 3);
}

export async function buildShiftDraft(companyId: string, input: { month?: unknown; needs?: unknown; includeUnsubmitted?: unknown }, now = new Date()) {
  const today = jstDateKey(now);
  const month = parseMonth(input.month, addMonth(today.slice(0, 7), 1));
  if (month < today.slice(0, 7)) throw new UserError("過ぎた月のシフトは作れません");
  const needs = input.needs === undefined ? await suggestNeeds(companyId, now) : parseNeeds(input.needs);
  const includeUnsubmitted = input.includeUnsubmitted === true;
  const range = monthDateRange(month);
  // 週の上限を数えるため、月の前後の週にかかる分も読む
  const wide = { gte: new Date(range.gte.getTime() - 7 * DAY), lt: new Date(range.lt.getTime() + 7 * DAY) };
  const [staff, requests, existing, revenue] = await Promise.all([
    prisma.staff.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, hourlyWage: true, weeklyDays: true } }),
    prisma.shiftRequest.findMany({ where: { companyId, date: range, staff: { active: true } } }),
    prisma.shift.findMany({ where: { companyId, date: wide }, select: { staffId: true, date: true, startMinutes: true, endMinutes: true, breakMinutes: true } }),
    averageRevenue(companyId, now),
  ]);
  if (!staff.length) throw new UserError("スタッフがいません。先にシフト表でスタッフを登録してください");

  const key = (staffId: string, date: string) => `${staffId}:${date}`;
  const reqBy = new Map(requests.map((r) => [key(r.staffId, jstDateKey(r.date)), r]));
  const working = new Set(existing.map((s) => key(s.staffId, jstDateKey(s.date))));
  const weekCount = new Map<string, number>();
  for (const k of working) {
    const [staffId, date] = k.split(":");
    weekCount.set(key(staffId, weekOf(date)), (weekCount.get(key(staffId, weekOf(date))) ?? 0) + 1);
  }
  const assigned = new Map<string, number>(staff.map((s) => [s.id, 0]));
  for (const k of working) {
    const [staffId, date] = k.split(":");
    if (date.startsWith(month) && assigned.has(staffId)) assigned.set(staffId, assigned.get(staffId)! + 1);
  }
  const availableDays = new Map(staff.map((s) => [s.id, requests.filter((r) => r.staffId === s.id && r.available).length]));

  const draft: DraftShift[] = [];
  const shortages: { date: string; weekday: string; need: number; have: number }[] = [];
  const days = daysOf(month).filter((d) => d.date >= today);
  for (const d of days) {
    const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    const need = needs[wd];
    const already = staff.filter((s) => working.has(key(s.id, d.date))).length;
    let have = already;
    if (need.count > have) {
      const candidates = staff
        .filter((s) => !working.has(key(s.id, d.date)))
        .map((s) => ({ s, r: reqBy.get(key(s.id, d.date)) }))
        .filter(({ s, r }) => (r ? r.available : includeUnsubmitted) && (weekCount.get(key(s.id, weekOf(d.date))) ?? 0) < Math.max(1, s.weeklyDays))
        .sort((a, b) => {
          const pa = a.r ? 0 : 1;
          const pb = b.r ? 0 : 1;
          if (pa !== pb) return pa - pb;
          // これまでに入った日数(出られる日数に対する割合)が少ない人から
          const ra = assigned.get(a.s.id)! / Math.max(1, availableDays.get(a.s.id)!);
          const rb = assigned.get(b.s.id)! / Math.max(1, availableDays.get(b.s.id)!);
          if (ra !== rb) return ra - rb;
          return a.s.hourlyWage - b.s.hourlyWage || a.s.name.localeCompare(b.s.name, "ja");
        });
      for (const { s, r } of candidates) {
        if (have >= need.count) break;
        const start = r?.startMinutes ?? parseTime(need.start)!;
        const end = r?.endMinutes ?? parseTime(need.end)!;
        if (end <= start) continue;
        const breakMinutes = breakFor(end - start);
        const p = dailyPay([{ startMinutes: start, endMinutes: end, breakMinutes }], s.hourlyWage);
        draft.push({ staffId: s.id, name: s.name, date: d.date, start: hhmm(start), end: hhmm(end), breakMinutes, requested: !!r, pay: Math.round(p.base + p.night + p.overtime) });
        working.add(key(s.id, d.date));
        weekCount.set(key(s.id, weekOf(d.date)), (weekCount.get(key(s.id, weekOf(d.date))) ?? 0) + 1);
        assigned.set(s.id, assigned.get(s.id)! + 1);
        have += 1;
      }
    }
    if (need.count > have) shortages.push({ date: d.date, weekday: d.weekday, need: need.count, have });
  }

  // 人件費の見込み(すでにあるシフト+下書き)
  const existingPay = existing
    .filter((s) => jstDateKey(s.date).startsWith(month))
    .reduce((sum, s) => {
      const st = staff.find((x) => x.id === s.staffId);
      if (!st) return sum;
      const p = dailyPay([s], st.hourlyWage);
      return sum + p.base + p.night + p.overtime;
    }, 0);
  const draftPay = draft.reduce((s, x) => s + x.pay, 0);
  const laborCost = Math.round(existingPay + draftPay);
  const perStaff = staff.map((s) => {
    const mine = draft.filter((x) => x.staffId === s.id);
    const minutes = mine.reduce((sum, x) => sum + (parseTime(x.end)! - parseTime(x.start)! - x.breakMinutes), 0);
    const submitted = requests.filter((r) => r.staffId === s.id).length;
    return { staffId: s.id, name: s.name, hourlyWage: s.hourlyWage, weeklyDays: s.weeklyDays, submitted, availableDays: availableDays.get(s.id)!, draftDays: mine.length, totalDays: assigned.get(s.id)!, draftHours: Math.round(minutes / 6) / 10, draftPay: mine.reduce((sum, x) => sum + x.pay, 0) };
  });
  const notes: string[] = [];
  if (shortages.length) notes.push(`人が足りない日が ${shortages.length}日 あります(${shortages.slice(0, 5).map((s) => `${Number(s.date.slice(8))}日(${s.weekday})あと${s.need - s.have}人`).join("、")}${shortages.length > 5 ? "ほか" : ""})。`);
  const noRequest = perStaff.filter((p) => p.submitted === 0);
  if (noRequest.length) notes.push(`シフト希望を出していない人: ${noRequest.map((p) => p.name).join("、")}${includeUnsubmitted ? "(必要な時間帯で入れています)" : "(入れていません)"}`);
  const unused = perStaff.filter((p) => p.availableDays > 0 && p.totalDays === 0);
  if (unused.length) notes.push(`出られる日があるのに入っていない人: ${unused.map((p) => p.name).join("、")}`);
  const ratio = revenue > 0 ? laborCost / revenue : null;
  if (ratio !== null) notes.push(`この月の人件費の見込み ${formatYen(laborCost)} は、直近3か月の売上の平均 ${formatYen(revenue)} の ${Math.round(ratio * 100)}% です。`);
  return { month, needs, includeUnsubmitted, draft, shortages, perStaff, laborCost, existingPay: Math.round(existingPay), draftPay, revenue, ratio, notes, existingCount: existing.filter((s) => jstDateKey(s.date).startsWith(month)).length };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "下書きの見立て(2〜3文)" },
    points: { type: "array", items: { type: "string" }, description: "気をつけること・直すとよいこと(各1文、5つまで)" },
  },
  required: ["summary", "points"],
  additionalProperties: false,
};

export async function reviewShiftDraft(user: { id: string; companyId: string }, input: { month?: unknown; needs?: unknown; includeUnsubmitted?: unknown }) {
  const r = await buildShiftDraft(user.companyId, input);
  let summary = r.draft.length
    ? `${r.draft.length}件のシフトの下書きを作りました。${r.shortages.length ? `人が足りない日が ${r.shortages.length}日 あります。` : "必要な人数はすべての日で足りています。"}`
    : r.shortages.length
      ? "入れられる人がいないため、下書きを作れませんでした。シフト希望の提出を呼びかけてください。"
      : "必要な人数はすでに足りています(新しく入れるシフトはありません)。";
  let points: string[] = [];
  let mode: "claude" | "template" = "template";
  const ai = await aiFor(user.companyId);
  if (ai) {
    const today = jstDateKey(new Date());
    if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system: [
          {
            type: "text",
            text: "あなたは小さなお店の店長の右腕です。決まったルールで作ったシフトの下書き(スタッフごとの日数・時間・時給・出られる日数、足りない日、人件費の見込みと売上に対する割合)を読み、偏り(特定の人に寄っている・出られるのに少ない)、足りない日の埋め方(誰に声をかけるか)、人件費の高さを短く指摘してください。数字は渡したものだけを使い、作らないでください。",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              month: r.month,
              needsByWeekday: r.needs.map((n, i) => ({ weekday: WEEKDAYS[i], ...n })),
              staff: r.perStaff.map((p) => ({ name: p.name, hourlyWage: p.hourlyWage, maxDaysPerWeek: p.weeklyDays, requestDaysSubmitted: p.submitted, availableDays: p.availableDays, draftDays: p.draftDays, totalDaysThisMonth: p.totalDays, draftHours: p.draftHours })),
              shortages: r.shortages,
              laborCost: r.laborCost,
              averageMonthlyRevenue: r.revenue,
              laborCostRatio: r.ratio === null ? null : Math.round(r.ratio * 1000) / 10,
            }),
          },
        ],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const raw = JSON.parse(
          response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
        ) as { summary?: unknown; points?: unknown };
        const s = String(raw.summary ?? "").trim().slice(0, 400);
        if (s) summary = s;
        points = (Array.isArray(raw.points) ? raw.points : [])
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim().slice(0, 160))
          .filter(Boolean)
          .slice(0, 5);
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "シフトの自動作成", tools: [], mode: `shiftdraft-${mode}` } });
  }
  return { ...r, summary, points, mode };
}

// 下書きからシフトを作る(人が選んだもの。すでにその日にシフトがある人・休みの希望の日は作らない)
export async function createShiftsFromDraft(companyId: string, input: { month?: unknown; items?: unknown }) {
  const today = jstDateKey(new Date());
  const month = parseMonth(input.month, "");
  if (!month) throw new UserError("月を正しく指定してください");
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 2000).map((x) => (x ?? {}) as Record<string, unknown>);
  if (!items.length) throw new UserError("作るシフトがありません");
  const range = monthDateRange(month);
  const [staff, existing, offs] = await Promise.all([
    prisma.staff.findMany({ where: { companyId, active: true }, select: { id: true } }),
    prisma.shift.findMany({ where: { companyId, date: range }, select: { staffId: true, date: true } }),
    prisma.shiftRequest.findMany({ where: { companyId, date: range, available: false }, select: { staffId: true, date: true } }),
  ]);
  const ids = new Set(staff.map((s) => s.id));
  const taken = new Set([...existing, ...offs].map((s) => `${s.staffId}:${jstDateKey(s.date)}`));
  const create: { companyId: string; staffId: string; date: Date; startMinutes: number; endMinutes: number; breakMinutes: number; note: string }[] = [];
  let skipped = 0;
  for (const it of items) {
    const staffId = String(it.staffId ?? "");
    const date = String(it.date ?? "");
    const start = parseTime(String(it.start ?? ""));
    const end = parseTime(String(it.end ?? ""));
    if (!ids.has(staffId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(month) || date < today || start === null || end === null || end <= start) throw new UserError("下書きの内容が正しくありません。作り直してください");
    if (taken.has(`${staffId}:${date}`)) {
      skipped += 1;
      continue;
    }
    taken.add(`${staffId}:${date}`);
    create.push({ companyId, staffId, date: new Date(`${date}T00:00:00Z`), startMinutes: start, endMinutes: end, breakMinutes: breakFor(end - start), note: "シフトの自動作成" });
  }
  if (create.length) await prisma.shift.createMany({ data: create });
  return { month, created: create.length, skipped, shifts: create };
}
