import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";
import { createAnnouncement } from "@/lib/announcements";

// 議事録: 会議のメモ(箇条書き・走り書き)を、議題・話し合ったこと・決まったこと・やること(担当・期限)に整えて残す。
// ・決まったルールで: 行の頭の言葉(決定・TODO・議題など)や「@担当」「10/20まで」から振り分ける
// ・AIで: メモに書いてあることだけをもとに整える(書いていない担当・期限は作らない)
// 保存した議事録は印刷でき、社内のお知らせにも載せられる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ActionItem = { task: string; owner: string | null; due: string | null };
export type MinutesContent = { agenda: string[]; discussion: string[]; decisions: string[]; actions: ActionItem[] };
export type MinutesDraft = { title: string; heldOn: string; place: string | null; attendees: string[]; content: MinutesContent; mode: "claude" | "template" };

const LIMITS = { item: 300, items: 30, actions: 30, owner: 30, title: 100, place: 60, attendee: 30, attendees: 30, notes: 8000 };

const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// 「10/20まで」「10月20日まで」「2026-10-20」→ YYYY-MM-DD(会議の日より前なら翌年とみなす)
export function parseDue(text: string, heldOn: string): string | null {
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const md = text.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/);
  let key: string | null = null;
  if (iso) key = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  else if (md) {
    let y = Number(heldOn.slice(0, 4));
    const cand = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    if (cand < heldOn) y += 1;
    key = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  }
  return key && validDate(key) ? key : null;
}

// 行頭の記号・番号(「・」「- 」「1.」「(2)」など)を取る。「10月」のような数字は残す
const clean = (s: string) => s.replace(/^\s*(?:[・\-*•●○◯■◆▶→>#]+\s*|[(\uFF08]?\d{1,2}[.)、\uFF09]\s*)+/, "").trim();
const DUE_TEXT = /\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*[/月]\s*\d{1,2}\s*日?)\s*(?:まで(?:に)?)?/g;
// 「山田さんが作る」のように、人がこれからすることを書いた行
const SOMEONE_WILL = /[^\s、,,]{1,10}さん(?:が|に)[^。]*(?:する|作る|やる|送る|調べる|まとめる|決める|頼む|手配|準備|連絡|確認|提出|用意)。?$/;

// 決まったルールでの整理
export function templateMinutes(notes: string, base: { title?: string; heldOn: string; place?: string | null; attendees?: string[] }): MinutesDraft {
  const agenda: string[] = [];
  const discussion: string[] = [];
  const decisions: string[] = [];
  const actions: ActionItem[] = [];
  let attendees = base.attendees ?? [];
  let place = base.place ?? null;
  let title = base.title ?? "";
  for (const raw of notes.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[・\-*•]\s*)?(出席者?|参加者?|メンバー|場所|件名|会議名|議題|アジェンダ|決定事項?|決まった(?:こと)?|結論|TODO|ToDo|todo|やること|宿題|アクション|次回まで)\s*[:\uFF1A]\s*(.*)$/);
    const head = m?.[1] ?? "";
    const body = clean(m ? m[2] : line);
    if (/^(出席|参加|メンバー)/.test(head)) {
      if (!base.attendees?.length) attendees = body.split(/[、,,\s]+/).map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (head === "場所") {
      place = place || body || null;
      continue;
    }
    if (head === "件名" || head === "会議名") {
      title = title || body;
      continue;
    }
    if (!body) continue;
    if (/^(議題|アジェンダ)/.test(head) || /^#/.test(line)) agenda.push(body);
    else if (/^(決定|決まった|結論)/.test(head) || /^(→\s*)?決定[::\s]/.test(line) || /(に決定|と決定|で決まり|ことにする|することになった)。?$/.test(body)) decisions.push(body.replace(/^決定[::\s]*/, ""));
    else if (/^(TODO|ToDo|todo|やること|宿題|アクション|次回まで)/.test(head) || /^(TODO|☐|□|\[ \])/i.test(body) || /@\S+|担当[:\uFF1A]|までに/.test(body) || SOMEONE_WILL.test(body) || (/まで/.test(body) && parseDue(body, base.heldOn))) {
      const ownerMatch = body.match(/@([^\s、,\uFF0C()\uFF08\uFF09]+)|担当[:\uFF1A]\s*([^\s、,\uFF0C()\uFF08\uFF09]+)|([一-龯々ァ-ヶーA-Za-z]{1,8})さん(?:が|に)/);
      const owner = ownerMatch ? (ownerMatch[1] ?? ownerMatch[2] ?? ownerMatch[3]) : null;
      const task = body
        .replace(/^(TODO|☐|□|\[ \])\s*/i, "")
        .replace(/[(\uFF08]?\s*(@[^\s、,\uFF0C()\uFF08\uFF09]+|担当[:\uFF1A]\s*[^\s、,\uFF0C()\uFF08\uFF09]+)\s*[)\uFF09]?/g, "")
        .replace(DUE_TEXT, "")
        .trim();
      actions.push({ task: task || body, owner: owner ? owner.slice(0, LIMITS.owner) : null, due: parseDue(body, base.heldOn) });
    } else discussion.push(body);
  }
  return {
    title: (title || "打ち合わせ").slice(0, LIMITS.title),
    heldOn: base.heldOn,
    place: place ? place.slice(0, LIMITS.place) : null,
    attendees: attendees.slice(0, LIMITS.attendees).map((a) => a.slice(0, LIMITS.attendee)),
    content: {
      agenda: agenda.slice(0, LIMITS.items).map((s) => s.slice(0, LIMITS.item)),
      discussion: discussion.slice(0, LIMITS.items).map((s) => s.slice(0, LIMITS.item)),
      decisions: decisions.slice(0, LIMITS.items).map((s) => s.slice(0, LIMITS.item)),
      actions: actions.slice(0, LIMITS.actions).map((a) => ({ ...a, task: a.task.slice(0, LIMITS.item) })),
    },
    mode: "template",
  };
}

function parseBase(input: { title?: unknown; heldOn?: unknown; place?: unknown; attendees?: unknown }) {
  const heldOn = String(input.heldOn ?? "") || jstDateKey(new Date());
  if (!validDate(heldOn)) throw new UserError("会議の日を正しく入れてください");
  const attendees = (Array.isArray(input.attendees) ? input.attendees.map(String) : String(input.attendees ?? "").split(/[、,,\n]+/))
    .map((s) => s.trim())
    .filter(Boolean);
  return { title: String(input.title ?? "").trim().slice(0, LIMITS.title), heldOn, place: String(input.place ?? "").trim().slice(0, LIMITS.place) || null, attendees };
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "会議の名前(メモに書いてなければ内容から短く)" },
    attendees: { type: "array", items: { type: "string" }, description: "出席者(メモに書いてある人だけ)" },
    agenda: { type: "array", items: { type: "string" } },
    discussion: { type: "array", items: { type: "string" }, description: "話し合ったこと(要点を1文ずつ)" },
    decisions: { type: "array", items: { type: "string" }, description: "決まったこと" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { task: { type: "string" }, owner: { type: ["string", "null"] }, due: { type: ["string", "null"], description: "YYYY-MM-DD。メモに期限がなければ null" } },
        required: ["task", "owner", "due"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "attendees", "agenda", "discussion", "decisions", "actions"],
  additionalProperties: false,
};

const strings = (v: unknown, max: number, len: number) =>
  (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);

// メモを整える(保存はしない)
export async function draftMinutes(user: { id: string; companyId: string }, input: { notes?: unknown; title?: unknown; heldOn?: unknown; place?: unknown; attendees?: unknown; useAi?: unknown }) {
  const notes = String(input.notes ?? "").trim();
  if (!notes) throw new UserError("会議のメモを入れてください");
  if (notes.length > LIMITS.notes) throw new UserError(`メモは${LIMITS.notes.toLocaleString()}文字以内にしてください`);
  const base = parseBase(input);
  const template = templateMinutes(notes, base);
  if (input.useAi !== true) return template;
  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: MinutesDraft = template;
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の会議の議事録を整える担当者です。渡したメモ(notes)を、議題・話し合ったこと・決まったこと・やること(担当・期限)に整理してください。",
            "メモに書いてあることだけを使い、書いていない決定・担当・期限・数字は作らないでください。担当や期限がわからないやることは owner・due を null にします。期限は会議の日(heldOn)をもとに YYYY-MM-DD で書きます。",
            "話し言葉や略語は、読みやすい短い文に直してください。決まったことと、まだ検討中のことは分けてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ heldOn: base.heldOn, title: base.title || null, attendees: base.attendees, notes }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const raw = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as Record<string, unknown>;
      const actions = (Array.isArray(raw.actions) ? raw.actions : [])
        .map((a) => a as { task?: unknown; owner?: unknown; due?: unknown })
        .filter((a) => typeof a.task === "string" && a.task.trim())
        .map((a) => ({
          task: String(a.task).trim().slice(0, LIMITS.item),
          owner: typeof a.owner === "string" && a.owner.trim() ? a.owner.trim().slice(0, LIMITS.owner) : null,
          due: typeof a.due === "string" && validDate(a.due) ? a.due : null,
        }))
        .slice(0, LIMITS.actions);
      const content: MinutesContent = {
        agenda: strings(raw.agenda, LIMITS.items, LIMITS.item),
        discussion: strings(raw.discussion, LIMITS.items, LIMITS.item),
        decisions: strings(raw.decisions, LIMITS.items, LIMITS.item),
        actions,
      };
      if (content.discussion.length + content.decisions.length + content.actions.length > 0) {
        const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.replace(/[\r\n]/g, " ").trim().slice(0, LIMITS.title) : template.title;
        // 入れた出席者があればそちらを使う
        const attendees = base.attendees.length ? template.attendees : strings(raw.attendees, LIMITS.attendees, LIMITS.attendee);
        result = { title: base.title || title, heldOn: base.heldOn, place: template.place, attendees, content, mode: "claude" };
      }
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "議事録の整理", tools: [], mode: `minutes-${result.mode}` } });
  return result;
}

// ---- 保存・一覧 ----

function parseContent(v: unknown): MinutesContent {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    agenda: strings(c.agenda, LIMITS.items, LIMITS.item),
    discussion: strings(c.discussion, LIMITS.items, LIMITS.item),
    decisions: strings(c.decisions, LIMITS.items, LIMITS.item),
    actions: (Array.isArray(c.actions) ? c.actions : [])
      .map((a) => a as { task?: unknown; owner?: unknown; due?: unknown })
      .filter((a) => typeof a.task === "string" && a.task.trim())
      .map((a) => {
        const due = typeof a.due === "string" ? a.due.trim() : "";
        if (due && !validDate(due)) throw new UserError("やることの期限を正しく入れてください");
        return { task: String(a.task).trim().slice(0, LIMITS.item), owner: typeof a.owner === "string" && a.owner.trim() ? a.owner.trim().slice(0, LIMITS.owner) : null, due: due || null };
      })
      .slice(0, LIMITS.actions),
  };
}

const toView = (m: { id: string; title: string; heldOn: Date; place: string | null; attendees: string[]; content: Prisma.JsonValue; notes: string; mode: string; announcementId: string | null; createdByName: string; createdAt: Date; updatedAt: Date }) => ({
  id: m.id,
  title: m.title,
  heldOn: jstDateKey(m.heldOn),
  place: m.place,
  attendees: m.attendees,
  content: parseContentSafe(m.content),
  notes: m.notes,
  mode: m.mode,
  announcementId: m.announcementId,
  createdByName: m.createdByName,
  updatedAt: m.updatedAt.toISOString(),
});
function parseContentSafe(v: Prisma.JsonValue) {
  try {
    return parseContent(v);
  } catch {
    return { agenda: [], discussion: [], decisions: [], actions: [] } as MinutesContent;
  }
}
export type MinutesView = ReturnType<typeof toView>;

export async function listMinutes(companyId: string) {
  const rows = await prisma.minutes.findMany({ where: { companyId }, orderBy: [{ heldOn: "desc" }, { createdAt: "desc" }], take: 100 });
  return rows.map(toView);
}

export async function getMinutes(companyId: string, id: string) {
  const m = await prisma.minutes.findFirst({ where: { id, companyId } });
  return m ? toView(m) : null;
}

function parseSave(input: Record<string, unknown>) {
  const base = parseBase(input);
  if (!base.title) throw new UserError("会議の名前を入れてください");
  const content = parseContent(input.content);
  if (!content.agenda.length && !content.discussion.length && !content.decisions.length && !content.actions.length) throw new UserError("議事録の中身が空です");
  return {
    title: base.title,
    heldOn: new Date(`${base.heldOn}T00:00:00+09:00`),
    place: base.place,
    attendees: base.attendees.slice(0, LIMITS.attendees).map((a) => a.slice(0, LIMITS.attendee)),
    content: content as unknown as Prisma.InputJsonValue,
    notes: String(input.notes ?? "").slice(0, LIMITS.notes),
    mode: input.mode === "claude" ? "claude" : "template",
  };
}

export async function saveMinutes(user: { companyId: string; name: string }, input: Record<string, unknown>, id?: string) {
  const data = parseSave(input);
  if (id) {
    const current = await prisma.minutes.findFirst({ where: { id, companyId: user.companyId } });
    if (!current) throw new UserError("議事録が見つかりません");
    const m = await prisma.minutes.update({ where: { id }, data });
    await audit("議事録の更新", `${m.title}(${jstDateKey(m.heldOn)})`);
    return toView(m);
  }
  const m = await prisma.minutes.create({ data: { ...data, companyId: user.companyId, createdByName: user.name.slice(0, 60) } });
  await audit("議事録の作成", `${m.title}(${jstDateKey(m.heldOn)})`);
  return toView(m);
}

export async function deleteMinutes(companyId: string, id: string) {
  const m = await prisma.minutes.findFirst({ where: { id, companyId } });
  if (!m) throw new UserError("議事録が見つかりません");
  await prisma.minutes.delete({ where: { id } });
  await audit("議事録の削除", `${m.title}(${jstDateKey(m.heldOn)})`);
  return { ok: true };
}

const md = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

// お知らせの本文(文字だけ)
export function minutesText(m: Pick<MinutesView, "title" | "heldOn" | "place" | "attendees" | "content">) {
  const lines = [`日時: ${m.heldOn.replaceAll("-", "/")}${m.place ? ` 場所: ${m.place}` : ""}`];
  if (m.attendees.length) lines.push(`出席: ${m.attendees.join("、")}`);
  const section = (label: string, items: string[]) => {
    if (!items.length) return;
    lines.push("", `【${label}】`, ...items.map((i) => `・${i}`));
  };
  section("議題", m.content.agenda);
  section("決まったこと", m.content.decisions);
  section("話し合ったこと", m.content.discussion);
  section(
    "やること",
    m.content.actions.map((a) => `${a.task}${a.owner ? `(担当: ${a.owner})` : ""}${a.due ? `(${md(a.due)}まで)` : ""}`),
  );
  return lines.join("\n");
}

export async function postMinutesAsAnnouncement(user: { id: string; name: string; companyId: string; role: "ADMIN" | "ACCOUNTANT" | "EMPLOYEE" | "ADVISOR" }, id: string, input: { notify?: unknown }, request?: Request) {
  const m = await getMinutes(user.companyId, id);
  if (!m) throw new UserError("議事録が見つかりません");
  if (m.announcementId && (await prisma.announcement.findFirst({ where: { id: m.announcementId, companyId: user.companyId } }))) throw new UserError("この議事録はもうお知らせに載せています");
  const { announcement, mailed } = await createAnnouncement(user, { title: `議事録: ${m.title}`.slice(0, 100), body: minutesText(m).slice(0, 5000), notify: input.notify === true }, request);
  await prisma.minutes.update({ where: { id }, data: { announcementId: announcement.id } });
  return { announcementId: announcement.id, mailed };
}
