import { prisma } from "@/lib/prisma";

// Single-tenant bootstrap: this MVP ships with one seeded company and scopes
// every request to it. Swap this out once multi-tenant/company switching is
// added; who is acting is now resolved separately via src/lib/auth.ts.

export async function getDefaultCompanyId(): Promise<string> {
  const company = await prisma.company.findFirstOrThrow();
  return company.id;
}
