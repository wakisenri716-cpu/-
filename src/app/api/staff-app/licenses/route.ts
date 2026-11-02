import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myLicenses, saveOwnLicense } from "@/lib/staffLicenses";

// 自分の資格・免許
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ licenses: await myLicenses(user) }));
}

// 自分で登録する: { name, number, expiresOn }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ license: await saveOwnLicense(user, body) }), 201);
}
