import { NextResponse } from "next/server";
import { UserError } from "@/lib/errors";

export async function respond(fn: () => Promise<unknown>, status = 200) {
  try {
    return NextResponse.json((await fn()) ?? { ok: true }, { status });
  } catch (error) {
    if (error instanceof UserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
