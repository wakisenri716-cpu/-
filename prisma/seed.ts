import { PrismaClient } from "@prisma/client";
import { CHART_OF_ACCOUNTS } from "../src/lib/accounting/chartOfAccounts";

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { id: "demo-company" },
    update: {},
    create: { id: "demo-company", name: "デモ株式会社" },
  });

  for (const account of CHART_OF_ACCOUNTS) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: account.code } },
      update: { name: account.name, category: account.category },
      create: { companyId: company.id, ...account },
    });
  }

  await prisma.user.upsert({
    where: { email: "admin@demo.example.com" },
    update: {},
    create: { companyId: company.id, name: "管理者 太郎", email: "admin@demo.example.com", role: "ADMIN" },
  });

  await prisma.user.upsert({
    where: { email: "employee@demo.example.com" },
    update: {},
    create: { companyId: company.id, name: "従業員 花子", email: "employee@demo.example.com", role: "EMPLOYEE" },
  });

  await prisma.automationRule.upsert({
    where: { companyId_sourceType: { companyId: company.id, sourceType: "EXPENSE_ITEM" } },
    update: {},
    create: { companyId: company.id, sourceType: "EXPENSE_ITEM", minConfidence: 0.9, maxAutoAmount: 50000 },
  });

  await prisma.automationRule.upsert({
    where: { companyId_sourceType: { companyId: company.id, sourceType: "INVOICE" } },
    update: {},
    create: { companyId: company.id, sourceType: "INVOICE", minConfidence: 0.9, maxAutoAmount: 300000 },
  });

  console.log("Seed complete:", { companyId: company.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
