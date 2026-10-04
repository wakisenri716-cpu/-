import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { TRIAL_DAYS, planOfPrice, plans, priceIdOf, type PlanKey } from "./plans";

// 有料プラン(Stripe のサブスクリプション)。STRIPE_SECRET_KEY を設定するまでは課金せず、全機能をそのまま使える。

export function billingEnabled() {
  return !!process.env.STRIPE_SECRET_KEY;
}

let client: Stripe | null = null;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new UserError("お支払いの設定(Stripe)がまだされていません");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

export type BillingFields = {
  plan: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  billingFree?: boolean;
  isDemo?: boolean;
};

export const BILLING_SELECT = { plan: true, subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, createdAt: true, billingFree: true, isDemo: true } as const;

// Stripe の状態のうち、使えるもの(past_due は支払いの再試行中なので、しばらくは使える)
const PAYING = ["active", "trialing", "past_due"];

export function trialEnd(c: BillingFields) {
  return c.trialEndsAt ?? new Date(c.createdAt.getTime() + TRIAL_DAYS * 86_400_000);
}

// off: 課金の設定なし / free: 運営者が無料にした会社 / trial: 無料期間中 / active: 契約中 / past_due: 支払いが失敗して再試行中 / expired: 無料期間が終わって未契約
export function billingState(c: BillingFields, now = new Date()) {
  const end = trialEnd(c);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
  const base = { trialEndsAt: end, daysLeft, plan: (c.plan as PlanKey | null) ?? null, cancelAtPeriodEnd: c.cancelAtPeriodEnd, currentPeriodEnd: c.currentPeriodEnd };
  if (!billingEnabled()) return { ...base, phase: "off" as const, access: true };
  // 運営者メニューで無料にした会社
  if (c.billingFree || c.isDemo) return { ...base, phase: "free" as const, access: true };
  if (c.subscriptionStatus && PAYING.includes(c.subscriptionStatus)) {
    return { ...base, phase: c.subscriptionStatus === "past_due" ? ("past_due" as const) : ("active" as const), access: true };
  }
  if (end > now) return { ...base, phase: "trial" as const, access: true };
  return { ...base, phase: "expired" as const, access: false };
}

export type BillingState = ReturnType<typeof billingState>;

// 運営者の会社など、お金をもらわない会社(BILLING_FREE_EMAILS に管理者のメールアドレスをカンマ区切りで)
export async function isFreeCompany(companyId: string) {
  const emails = (process.env.BILLING_FREE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) return false;
  return (await prisma.companyMember.count({ where: { companyId, role: "ADMIN", active: true, user: { email: { in: emails } } } })) > 0;
}

export async function companyBilling(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { ...BILLING_SELECT, name: true, stripeCustomerId: true, stripeSubscriptionId: true } });
  const state = billingState(company);
  const free = state.phase !== "off" && (await isFreeCompany(companyId));
  return { company, state: free ? { ...state, phase: "free" as const, access: true } : state };
}

// 期限切れでも開ける画面(契約の手続き・データの持ち出し・規約など)
export const BILLING_OPEN_PATHS = ["/billing", "/account", "/backup", "/accountant-export", "/pricing", "/tokushoho", "/operator"];

// ライトプランは管理者・経理担当の人数に上限がある(無料期間中は上限なし)
export async function checkSeat(companyId: string, role: string, exceptUserId?: string) {
  if (role === "EMPLOYEE") return;
  const { state } = await companyBilling(companyId);
  if (state.phase !== "active" && state.phase !== "past_due") return;
  const plan = plans()[state.plan ?? "STANDARD"];
  if (!plan?.seats) return;
  const used = await prisma.companyMember.count({ where: { companyId, active: true, role: { in: ["ADMIN", "ACCOUNTANT"] }, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) } });
  if (used + 1 > plan.seats) {
    throw new UserError(`${plan.name}プランの管理者・経理担当は${plan.seats}人までです。「契約・お支払い」でスタンダードプランに変えるか、従業員として追加してください`);
  }
}

// Stripe のサブスクリプションの内容を会社に写す(Webhook から呼ぶ)
export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const companyId = sub.metadata?.companyId;
  const company = await prisma.company.findFirst({ where: companyId ? { OR: [{ id: companyId }, { stripeCustomerId: customerId }] } : { stripeCustomerId: customerId }, select: { id: true } });
  if (!company) return null;
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  return prisma.company.update({
    where: { id: company.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: ended ? null : sub.id,
      subscriptionStatus: sub.status,
      plan: planOfPrice(item?.price?.id) ?? undefined,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: !ended && !!(sub.cancel_at_period_end || sub.cancel_at),
    },
  });
}

type Admin = { id: string; email: string; companyId: string; role: string };

function requireAdmin(user: Admin) {
  if (user.role !== "ADMIN") throw new UserError("契約・お支払いの手続きは管理者だけができます");
}

async function customerFor(user: Admin) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { id: true, name: true, stripeCustomerId: true } });
  if (company.stripeCustomerId) return company.stripeCustomerId;
  const customer = await stripe().customers.create({ email: user.email, name: company.name, metadata: { companyId: company.id } });
  await prisma.company.update({ where: { id: company.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// 申し込み: Stripe の支払い画面の URL を返す。無料期間が残っていれば、その終わりから課金する
export async function createCheckout(user: Admin, planValue: unknown, baseUrl: string) {
  requireAdmin(user);
  if (!billingEnabled()) throw new UserError("お支払いの設定(Stripe)がまだされていません");
  const plan = String(planValue ?? "") as PlanKey;
  if (!(plan in plans())) throw new UserError("プランを選んでください");
  const price = priceIdOf(plan);
  if (!price) throw new UserError(`${plans()[plan].name}プランの価格(STRIPE_PRICE_${plan})が設定されていません`);
  const { state } = await companyBilling(user.companyId);
  if (state.phase === "active" || state.phase === "past_due") throw new UserError("すでに契約中です。プランの変更・解約は「お支払い情報の管理」からできます");
  // Stripe は、無料期間の終わりを2日以上先にしか指定できない
  const trialEnd = state.phase === "trial" && state.trialEndsAt.getTime() - Date.now() > 2 * 86_400_000 ? Math.floor(state.trialEndsAt.getTime() / 1000) : undefined;
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: await customerFor(user),
    line_items: [{ price, quantity: 1 }],
    locale: "ja",
    allow_promotion_codes: true,
    metadata: { companyId: user.companyId },
    subscription_data: { metadata: { companyId: user.companyId }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    success_url: `${baseUrl}/billing?success=1`,
    cancel_url: `${baseUrl}/billing`,
  });
  if (!session.url) throw new UserError("お支払い画面を開けませんでした");
  return session.url;
}

// カードの変更・プランの変更・解約・領収書(Stripe のカスタマーポータル)
export async function createPortal(user: Admin, baseUrl: string) {
  requireAdmin(user);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { stripeCustomerId: true } });
  if (!company.stripeCustomerId) throw new UserError("まだお申し込みがありません");
  const session = await stripe().billingPortal.sessions.create({ customer: company.stripeCustomerId, return_url: `${baseUrl}/billing`, locale: "ja" });
  return session.url;
}
