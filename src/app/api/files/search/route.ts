import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { searchFiles } from "@/lib/files";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return NextResponse.json(await searchFiles(companyId, new URL(request.url).searchParams.get("q") ?? ""));
}
