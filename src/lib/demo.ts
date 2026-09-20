import { prisma } from "@/lib/prisma";

// Single-tenant demo bootstrap: this MVP ships with one seeded company and
// one seeded employee so the automation flow can be exercised end-to-end
// without building auth/tenant-switching first. Swap these for the
// authenticated session's company/user once auth is added.

export async function getDefaultCompanyId(): Promise<string> {
  const company = await prisma.company.findFirstOrThrow();
  return company.id;
}

export async function getDefaultEmployeeId(): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { role: "EMPLOYEE" } });
  return user.id;
}
