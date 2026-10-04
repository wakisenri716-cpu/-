import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// Stripe からのお知らせ(申し込み・更新・支払い失敗・解約)。署名を確かめてから会社の契約状態を更新する。
// Stripe のダッシュボードで、この URL(/api/stripe/webhook)を Webhook の送信先に登録する。
const EVENTS = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"];

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (EVENTS.includes(event.type)) {
    await syncSubscription(event.data.object as Stripe.Subscription);
  } else if (event.type === "checkout.session.completed") {
    // 申し込みが終わった: 顧客と会社をひも付ける(契約の中身は customer.subscription.* で届く)
    const session = event.data.object as Stripe.Checkout.Session;
    const companyId = session.metadata?.companyId;
    const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (companyId && customer) await prisma.company.updateMany({ where: { id: companyId, stripeCustomerId: null }, data: { stripeCustomerId: customer } });
  }
  return NextResponse.json({ received: true });
}
