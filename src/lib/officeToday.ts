import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { inventedNumbers } from "@/lib/ai/numberGuard";
import { jstDateKey } from "@/lib/jst";
import { visitorsOn } from "@/lib/visitors";
import { listBookings } from "@/lib/bookings";
import { carBookingsOn, missingChecks } from "@/lib/alcoholChecks";
import { countWaitingMail } from "@/lib/mailItems";
import { countOpenSupplyRequests } from "@/lib/supplyRequests";
import { countOpenQuestions } from "@/lib/staffQuestions";
import { listEvents } from "@/lib/companyEvents";
import { countLicenseAlerts } from "@/lib/staffLicenses";
import { countApplicantTodos } from "@/lib/applicants";
import { countVehicleAlerts } from "@/lib/vehicles";
import { countUnthanked } from "@/lib/gifts";
import { upcomingLeaves } from "@/lib/handover";

// 総務のきょう: 来客・会議室と社用車・アルコールチェック・郵便物・伝言・購入依頼・質問・イベント・資格・採用・休む人を1つの画面にまとめる。
// AIが使えるときは、今日いちばん気をつけることを短くまとめる(元の数字にない数字が入ったら決まった文に戻す)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

export async function officeFacts(companyId: string) {
  const today = jstDateKey(new Date());
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const [visitors, bookings, cars, missing, mail, memos, supplies, questions, events, licenses, applicants, vehicles, gifts, leaves] = await Promise.all([
    visitorsOn(companyId, today),
    listBookings(companyId, today, 1),
    carBookingsOn(companyId, today),
    missingChecks(companyId),
    countWaitingMail(companyId),
    prisma.phoneMemo.count({ where: { companyId, status: "OPEN" } }),
    countOpenSupplyRequests(companyId),
    countOpenQuestions(companyId),
    listEvents(companyId),
    countLicenseAlerts(companyId),
    countApplicantTodos(companyId),
    countVehicleAlerts(companyId),
    countUnthanked(companyId),
    upcomingLeaves(companyId, 0),
  ]);
  return {
    today,
    visitors: visitors.filter((v) => v.status !== "LEFT").map((v) => ({ time: v.time, label: v.label, host: v.host, arrived: v.status === "ARRIVED" })),
    bookings: bookings.filter((b) => b.facility.kind !== "CAR").map((b) => ({ facility: b.facility.name, time: `${b.start}〜${b.end}`, title: b.title, by: b.userName })),
    cars: cars.map((c) => ({ vehicle: c.vehicle, time: `${c.start}〜${c.end}`, driver: c.driverName, before: !!c.before, after: !!c.after })),
    alcoholMissing: missing.length,
    mailWaiting: mail.count,
    mailImportant: mail.important,
    memosOpen: memos,
    supplies: supplies.count,
    suppliesUrgent: supplies.urgent,
    questions,
    events: events.filter((e) => e.date >= today && e.date <= soon).map((e) => ({ title: e.title, date: e.date, yes: e.counts.YES, pending: e.closed ? 0 : e.pending.length })),
    licenseAlerts: licenses,
    interviewsToday: applicants.interviews,
    applicantsWaiting: applicants.waiting,
    vehicleAlerts: vehicles,
    unthankedGifts: gifts,
    offToday: leaves.filter((l) => l.dates.includes(today)).map((l) => l.name),
  };
}

export type OfficeFacts = Awaited<ReturnType<typeof officeFacts>>;

// AIを使わないときのまとめ(気をつけることを順に)
export function templateSummary(f: OfficeFacts) {
  const parts: string[] = [];
  if (f.alcoholMissing) parts.push(`アルコールチェックの記録が足りない社用車の予約が${f.alcoholMissing}件あります`);
  if (f.suppliesUrgent) parts.push(`至急の購入依頼が${f.suppliesUrgent}件あります`);
  if (f.visitors.length) parts.push(`今日は来客が${f.visitors.length}件あります`);
  if (f.interviewsToday) parts.push(`採用の面接が${f.interviewsToday}件あります`);
  if (f.mailImportant) parts.push(`書留・役所からの郵便物などが${f.mailImportant}件届いています`);
  if (f.offToday.length) parts.push(`${f.offToday.join("・")}さんがお休みです`);
  if (f.licenseAlerts) parts.push(`期限の近い資格・免許などが${f.licenseAlerts}件あります`);
  return parts.length ? `${parts.slice(0, 3).join("。")}。` : "今日の総務は落ち着いています。";
}

const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false } as const;

export async function officeSummary(user: { id: string; companyId: string }, facts: OfficeFacts, useAi: boolean) {
  const base = templateSummary(facts);
  if (!useAi) return { summary: base, mode: "template" as const };
  const ai = await aiFor(user.companyId);
  if (!ai) return { summary: base, mode: "template" as const };
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) return { summary: base, mode: "template" as const };
  let summary = base;
  let mode: "claude" | "template" = "template";
  const source = JSON.stringify(facts);
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の総務担当の手伝いです。今日の総務のこと(facts)から、まず気をつけること・やることを2〜3文の短い日本語でまとめます。",
            "安全や法令にかかわること(アルコールチェック・免許)と、時間が決まっていること(来客・面接)を先にしてください。facts にない数字・名前・時刻は書かないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: source }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const parsed = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { summary?: unknown };
      const out = String(parsed.summary ?? "").trim().slice(0, 400);
      if (out && !inventedNumbers(out, source).length) {
        summary = out;
        mode = "claude";
      }
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "総務のきょう", tools: [], mode: `office-today-${mode}` } });
  return { summary, mode };
}
