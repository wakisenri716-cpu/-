import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedDatabase } from "@/lib/seedDatabase";

// One-time bootstrap for hosted deployments with no terminal access (e.g.
// Vercel): visit this URL once after the first deploy to create the demo
// company, chart of accounts, and automation rules. Idempotent (safe to
// call again) and gated by SEED_SECRET so a stranger can't trigger it.
export async function GET(request: Request) {
  const secret = process.env.SEED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SEED_SECRET is not configured on the server" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "Invalid or missing secret" }, { status: 401 });
  }

  const result = await seedDatabase(prisma);
  return NextResponse.json({ ok: true, ...result });
}
