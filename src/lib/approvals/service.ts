import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { addTaken, checkTaken, leaveBalance } from "@/lib/leave/service";
import { sendMail } from "@/lib/mail";

// 稟議・申請。申請すると承認ルートの順に回り、全員が承認すると「承認」になる(だれかが差し戻せばそこで終わり)。
// 有給休暇の申請は、承認されると有給の取得として自動で登録する。

export class ApprovalError extends UserError {}

export type RequestKind = "LEAVE" | "PURCHASE" | "GENERAL";
export const KIND_LABELS: Record<RequestKind, string> = { LEAVE: "有給休暇", PURCHASE: "購入・支払", GENERAL: "その他" };
export const STATUS_LABELS: Record<string, string> = { PENDING: "承認待ち", APPROVED: "承認", REJECTED: "差戻し", WITHDRAWN: "取下げ" };
export const ACTION_LABELS: Record<string, string> = { SUBMIT: "申請", APPROVE: "承認", REJECT: "差戻し", WITHDRAW: "取下げ", COMMENT: "コメント", SKIP: "省略" };

// userId が null の段は「管理者のだれか」
export type Step = { userId: string | null; name: string };
type Actor = Pick<User, "id" | "name" | "role" | "companyId">;

const KINDS: RequestKind[] = ["LEAVE", "PURCHASE", "GENERAL"];
const text = (value: unknown, max: number) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

// ---- 承認ルート ----

export async function listRoutes(companyId: string) {
  const [routes, users] = await Promise.all([
    prisma.approvalRoute.findMany({ where: { companyId }, orderBy: [{ kind: "asc" }, { minAmount: "asc" }, { createdAt: "asc" }] }),
    prisma.companyMember
      .findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { role: true, user: { select: { id: true, name: true } } } })
      .then((ms) => ms.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role }))),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    routes: routes.map((r) => ({ ...r, approvers: r.approverIds.map((id) => ({ id, name: name.get(id) ?? "(無効なユーザー)" })) })),
    users,
  };
}

export async function createRoute(companyId: string, input: { name?: unknown; kind?: unknown; minAmount?: unknown; approverIds?: unknown }) {
  const name = text(input.name, 30);
  if (!name) throw new ApprovalError("ルートの名前を入力してください(例: 10万円以上の購入)");
  const kind = String(input.kind ?? "");
  if (kind !== "ALL" && !KINDS.includes(kind as RequestKind)) throw new ApprovalError("申請の種類を選んでください");
  const minAmount = input.minAmount === undefined || input.minAmount === "" ? 0 : Number(input.minAmount);
  if (!Number.isInteger(minAmount) || minAmount < 0 || minAmount > 10_000_000_000) throw new ApprovalError("金額を正しく入力してください");
  const ids = (Array.isArray(input.approverIds) ? input.approverIds : []).map(String).filter(Boolean);
  if (ids.length === 0) throw new ApprovalError("承認する人を1人以上選んでください");
  if (ids.length > 5) throw new ApprovalError("承認する人は5人までです");
  if (new Set(ids).size !== ids.length) throw new ApprovalError("同じ人が2回入っています");
  const found = await prisma.companyMember.count({ where: { companyId, active: true, userId: { in: ids } } });
  if (found !== ids.length) throw new ApprovalError("承認する人を選び直してください");
  return prisma.approvalRoute.create({ data: { companyId, name, kind, minAmount: kind === "PURCHASE" || kind === "ALL" ? minAmount : 0, approverIds: ids } });
}

export async function deleteRoute(companyId: string, id: string) {
  const route = await prisma.approvalRoute.findFirst({ where: { id, companyId } });
  if (!route) throw new ApprovalError("ルートが見つかりません");
  await prisma.approvalRoute.delete({ where: { id } });
  return route;
}

// 種類がぴったり合うルートを優先し、金額の条件がいちばん高いものを選ぶ。なければ「管理者のだれか」1段。
async function pickSteps(companyId: string, kind: RequestKind, amount: number | null): Promise<Step[]> {
  const routes = await prisma.approvalRoute.findMany({ where: { companyId, kind: { in: [kind, "ALL"] } } });
  const fits = routes
    .filter((r) => (amount ?? 0) >= r.minAmount)
    .sort((a, b) => Number(b.kind === kind) - Number(a.kind === kind) || b.minAmount - a.minAmount);
  const route = fits[0];
  if (!route) return [{ userId: null, name: "管理者" }];
  const users = await prisma.user.findMany({ where: { id: { in: route.approverIds }, memberships: { some: { companyId, active: true } } }, select: { id: true, name: true } });
  const steps = route.approverIds.flatMap((id) => {
    const u = users.find((x) => x.id === id);
    return u ? [{ userId: u.id, name: u.name }] : [];
  });
  return steps.length ? steps : [{ userId: null, name: "管理者" }];
}

// ---- だれが何をできるか ----

async function isSoleAdmin(companyId: string, userId: string) {
  const admins = await prisma.companyMember.findMany({ where: { companyId, role: "ADMIN", active: true }, select: { userId: true } });
  return admins.length === 1 && admins[0].userId === userId;
}

// いまの段を承認できるか。本人の申請は、管理者が本人しかいない会社を除いて承認できない。
async function canDecide(req: { companyId: string; requesterId: string; status: string; currentStep: number; steps: unknown }, user: Actor) {
  if (req.status !== "PENDING") return false;
  const step = (req.steps as Step[])[req.currentStep];
  if (!step) return false;
  if (step.userId) {
    if (step.userId === user.id) return true;
    // 承認者が退職などで使えなくなっていたら、管理者が代わりに承認・差戻しできる
    if (user.role !== "ADMIN" || user.id === req.requesterId) return false;
    return !(await prisma.companyMember.findFirst({ where: { userId: step.userId, companyId: req.companyId, active: true, user: { active: true } }, select: { id: true } }));
  }
  if (user.role !== "ADMIN") return false;
  return user.id !== req.requesterId || (await isSoleAdmin(req.companyId, user.id));
}

function canView(req: { requesterId: string; steps: unknown }, user: Actor) {
  if (user.role !== "EMPLOYEE") return true;
  return req.requesterId === user.id || (req.steps as Step[]).some((s) => s.userId === user.id);
}

// 申請者本人が承認者に入っている段は飛ばす
function skipOwnSteps(steps: Step[], from: number, requesterId: string) {
  let i = from;
  while (i < steps.length && steps[i].userId === requesterId) i++;
  return i;
}

// ---- 一覧・詳細 ----

export async function listRequests(user: Actor, view: string) {
  const all = await prisma.approvalRequest.findMany({
    where: { companyId: user.companyId, ...(view === "mine" ? { requesterId: user.id } : view === "todo" ? { status: "PENDING" } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const visible = [];
  for (const r of all) {
    if (!canView(r, user)) continue;
    if (view === "todo" && !(await canDecide(r, user))) continue;
    visible.push(r);
  }
  const staff = await prisma.staff.findFirst({ where: { companyId: user.companyId, userId: user.id, active: true }, select: { id: true, name: true } });
  return {
    requests: visible.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      title: r.title,
      amount: r.amount,
      leaveDate: r.leaveDate ? jstDateKey(r.leaveDate) : null,
      leaveHalfDays: r.leaveHalfDays,
      requesterName: r.requesterName,
      status: r.status,
      waitingFor: r.status === "PENDING" ? ((r.steps as Step[])[r.currentStep]?.name ?? null) : null,
      createdOn: jstDateKey(r.createdAt),
    })),
    me: {
      id: user.id,
      role: user.role,
      staff: staff ? { ...staff, balance: await leaveBalance(user.companyId, staff.id) } : null,
    },
    todoCount: view === "todo" ? visible.length : await countTodo(user),
  };
}

export async function countTodo(user: Actor) {
  const pending = await prisma.approvalRequest.findMany({ where: { companyId: user.companyId, status: "PENDING" } });
  let n = 0;
  for (const r of pending) if (await canDecide(r, user)) n++;
  return n;
}

export async function getRequest(user: Actor, id: string) {
  const req = await prisma.approvalRequest.findFirst({
    where: { id, companyId: user.companyId },
    include: { actions: { orderBy: { createdAt: "asc" } }, staff: { select: { name: true } }, company: { select: { name: true } } },
  });
  if (!req || !canView(req, user)) return null;
  const steps = req.steps as Step[];
  // 段ごとの結果(承認した人と日時)
  const stepResults = steps.map((s, i) => {
    const act = [...req.actions].reverse().find((a) => a.step === i && ["APPROVE", "REJECT", "SKIP"].includes(a.action));
    return { ...s, action: act?.action ?? null, by: act?.userName ?? null, at: act?.createdAt ?? null, current: req.status === "PENDING" && i === req.currentStep };
  });
  return {
    ...req,
    steps: stepResults,
    canDecide: await canDecide(req, user),
    canWithdraw: req.status === "PENDING" && req.requesterId === user.id,
  };
}

// ---- 申請 ----

async function nextNumber(companyId: string) {
  const year = jstDateKey(new Date()).slice(0, 4);
  const last = await prisma.approvalRequest.findFirst({ where: { companyId, number: { startsWith: `R-${year}-` } }, orderBy: { number: "desc" } });
  const seq = last ? Number(last.number.slice(7)) + 1 : 1;
  return `R-${year}-${String(seq).padStart(4, "0")}`;
}

export async function createRequest(user: Actor, input: Record<string, unknown>, baseUrl: string) {
  const kind = String(input.kind ?? "") as RequestKind;
  if (!KINDS.includes(kind)) throw new ApprovalError("申請の種類を選んでください");
  const body = text(input.body, 2000);
  let title = text(input.title, 60);
  let amount: number | null = null;
  let payee: string | null = null;
  let leave: { staffId: string; date: Date; halfDays: number } | null = null;

  if (kind === "LEAVE") {
    const staff = await prisma.staff.findFirst({ where: { companyId: user.companyId, userId: user.id, active: true } });
    if (!staff) throw new ApprovalError("あなたのアカウントがスタッフとひも付いていません。管理者に「有給・残業」の設定でひも付けてもらってください");
    const leaveKind = input.leaveKind === "HALF" ? "HALF" : "FULL";
    const checked = await checkTaken(user.companyId, { staffId: staff.id, date: input.leaveDate, kind: leaveKind });
    leave = { staffId: staff.id, date: checked.date, halfDays: checked.halfDays };
    title = title || `有給休暇 ${jstDateKey(checked.date).replaceAll("-", "/")}${leaveKind === "HALF" ? "(半日)" : ""}`;
  } else {
    if (!title) throw new ApprovalError("件名を入力してください");
    if (kind === "PURCHASE") {
      amount = Number(input.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000_000) throw new ApprovalError("金額を正しく入力してください(税込・円)");
      payee = text(input.payee, 60) || null;
    }
  }

  const steps = await pickSteps(user.companyId, kind, amount);
  const first = skipOwnSteps(steps, 0, user.id);
  const done = first >= steps.length;
  const skipped = steps.slice(0, first).map((s, i) => ({ step: i, userId: user.id, userName: s.name, action: "SKIP", comment: "申請者本人のため省略" }));

  // 承認する人が本人しかいないルートなら、その場で承認済みになる(有給はここで登録する)
  const taken = done && leave ? await registerLeave(user.companyId, leave, "") : null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const number = await nextNumber(user.companyId);
      try {
        const created = await prisma.approvalRequest.create({
          data: {
            companyId: user.companyId,
            number,
            kind,
            title,
            body,
            amount,
            payee,
            leaveDate: leave?.date ?? null,
            leaveHalfDays: leave?.halfDays ?? null,
            staffId: leave?.staffId ?? null,
            requesterId: user.id,
            requesterName: user.name,
            steps,
            currentStep: first,
            status: done ? "APPROVED" : "PENDING",
            decidedAt: done ? new Date() : null,
            leaveTakenId: taken?.id ?? null,
            actions: { create: [{ step: 0, userId: user.id, userName: user.name, action: "SUBMIT" }, ...skipped] },
          },
        });
        if (taken) await prisma.leaveTaken.update({ where: { id: taken.id }, data: { note: `稟議 ${number}` } });
        if (!done) await notifyApprovers(created.id, baseUrl);
        return created;
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") continue; // 同時に申請されて番号が重なった
        throw error;
      }
    }
    throw new ApprovalError("混み合っています。もう一度申請してください");
  } catch (error) {
    if (taken) await prisma.leaveTaken.delete({ where: { id: taken.id } }).catch(() => {});
    throw error;
  }
}

// 承認された有給休暇を、有給の取得として登録する
function registerLeave(companyId: string, leave: { staffId: string; date: Date; halfDays: number }, number: string) {
  return addTaken(companyId, { staffId: leave.staffId, date: jstDateKey(leave.date), kind: leave.halfDays === 1 ? "HALF" : "FULL", note: number ? `稟議 ${number}` : null });
}

// ---- 承認・差戻し・取下げ・コメント ----

export async function actOnRequest(user: Actor, id: string, input: { action?: unknown; comment?: unknown }, baseUrl: string) {
  const req = await prisma.approvalRequest.findFirst({ where: { id, companyId: user.companyId } });
  if (!req || !canView(req, user)) throw new ApprovalError("申請が見つかりません");
  const comment = text(input.comment, 500) || null;
  const action = String(input.action ?? "");
  const steps = req.steps as Step[];

  if (action === "comment") {
    if (!comment) throw new ApprovalError("コメントを入力してください");
    await prisma.approvalAction.create({ data: { requestId: id, step: req.currentStep, userId: user.id, userName: user.name, action: "COMMENT", comment } });
    return { number: req.number, status: req.status };
  }

  if (action === "withdraw") {
    if (req.requesterId !== user.id) throw new ApprovalError("取り下げられるのは申請した本人だけです");
    const updated = await prisma.approvalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
    if (updated.count !== 1) throw new ApprovalError("この申請はすでに処理されています");
    await prisma.approvalAction.create({ data: { requestId: id, step: req.currentStep, userId: user.id, userName: user.name, action: "WITHDRAW", comment } });
    return { number: req.number, status: "WITHDRAWN" };
  }

  if (action !== "approve" && action !== "reject") throw new ApprovalError("操作が正しくありません");
  if (!(await canDecide(req, user))) throw new ApprovalError("この申請を承認・差戻しできるのは、いまの段の承認者だけです");

  if (action === "reject") {
    if (!comment) throw new ApprovalError("差し戻す理由を入力してください");
    const updated = await prisma.approvalRequest.updateMany({ where: { id, status: "PENDING", currentStep: req.currentStep }, data: { status: "REJECTED", decidedAt: new Date() } });
    if (updated.count !== 1) throw new ApprovalError("この申請はすでに処理されています。画面を更新してください");
    await prisma.approvalAction.create({ data: { requestId: id, step: req.currentStep, userId: user.id, userName: user.name, action: "REJECT", comment } });
    await notifyRequester(id, baseUrl);
    return { number: req.number, status: "REJECTED" };
  }

  const next = skipOwnSteps(steps, req.currentStep + 1, req.requesterId);
  const done = next >= steps.length;
  // 最後の承認で有給を登録する(残りが足りない・打刻があるなどで登録できなければ、承認もしない)
  const taken =
    done && req.kind === "LEAVE" && req.staffId && req.leaveDate && !req.leaveTakenId
      ? await registerLeave(req.companyId, { staffId: req.staffId, date: req.leaveDate, halfDays: req.leaveHalfDays ?? 2 }, req.number)
      : null;
  const updated = await prisma.approvalRequest.updateMany({
    where: { id, status: "PENDING", currentStep: req.currentStep },
    data: done ? { status: "APPROVED", currentStep: next, decidedAt: new Date(), ...(taken ? { leaveTakenId: taken.id } : {}) } : { currentStep: next },
  });
  if (updated.count !== 1) {
    if (taken) await prisma.leaveTaken.delete({ where: { id: taken.id } }).catch(() => {});
    throw new ApprovalError("この申請はすでに処理されています。画面を更新してください");
  }
  await prisma.approvalAction.createMany({
    data: [
      { requestId: id, step: req.currentStep, userId: user.id, userName: user.name, action: "APPROVE", comment },
      ...steps.slice(req.currentStep + 1, next).map((s, i) => ({ requestId: id, step: req.currentStep + 1 + i, userId: req.requesterId, userName: s.name, action: "SKIP", comment: "申請者本人のため省略" })),
    ],
  });
  if (done) {
    await notifyRequester(id, baseUrl);
    return { number: req.number, status: "APPROVED" };
  }
  await notifyApprovers(id, baseUrl);
  return { number: req.number, status: "PENDING" };
}

// ---- お知らせメール(テストモードでは送らずに記録だけ) ----

async function safeSend(companyId: string, to: string, subject: string, body: string, relatedId: string) {
  try {
    await sendMail({ companyId, kind: "APPROVAL", to, subject, text: body, sentByName: "システム", relatedId });
  } catch {
    // お知らせが送れなくても、申請・承認そのものは続ける
  }
}

async function notifyApprovers(id: string, baseUrl: string) {
  const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
  const step = (req.steps as Step[])[req.currentStep];
  if (!step) return;
  const to = step.userId
    ? await prisma.user.findMany({ where: { id: step.userId, active: true, memberships: { some: { companyId: req.companyId, active: true } } }, select: { email: true } })
    : await prisma.user.findMany({
        where: { active: true, id: { not: req.requesterId }, memberships: { some: { companyId: req.companyId, role: "ADMIN", active: true } } },
        select: { email: true },
      });
  const body = [
    `${req.requesterName}さんから申請が届いています。内容を確認して、承認か差戻しをしてください。`,
    "",
    `番号: ${req.number}`,
    `種類: ${KIND_LABELS[req.kind as RequestKind]}`,
    `件名: ${req.title}`,
    req.amount ? `金額: ${req.amount.toLocaleString("ja-JP")}円` : "",
    "",
    `${baseUrl}/requests/${req.id}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
  for (const u of to) await safeSend(req.companyId, u.email, `【承認のお願い】${req.number} ${req.title}`, body, req.id);
}

async function notifyRequester(id: string, baseUrl: string) {
  const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id }, include: { requester: { select: { email: true, active: true } } } });
  if (!req.requester.active) return;
  const label = STATUS_LABELS[req.status];
  const last = await prisma.approvalAction.findFirst({ where: { requestId: id, action: { in: ["APPROVE", "REJECT"] } }, orderBy: { createdAt: "desc" } });
  const body = [
    `申請「${req.title}」(${req.number})が${label}されました。`,
    last?.comment ? `\n${last.userName}さんのコメント: ${last.comment}` : "",
    req.kind === "LEAVE" && req.status === "APPROVED" ? "\n有給休暇として登録しました。" : "",
    "",
    `${baseUrl}/requests/${req.id}`,
  ].join("\n");
  await safeSend(req.companyId, req.requester.email, `【${label}】${req.number} ${req.title}`, body, req.id);
}

