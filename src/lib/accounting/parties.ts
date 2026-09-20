import { prisma } from "@/lib/prisma";

export async function findOrCreateVendor(companyId: string, name: string) {
  const existing = await prisma.vendor.findFirst({ where: { companyId, name } });
  if (existing) return existing;
  return prisma.vendor.create({ data: { companyId, name } });
}

export async function findOrCreateCustomer(companyId: string, name: string) {
  const existing = await prisma.customer.findFirst({ where: { companyId, name } });
  if (existing) return existing;
  return prisma.customer.create({ data: { companyId, name } });
}
