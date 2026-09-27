import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { ipAllowed } from "@/lib/security";

// 複数の会社: 1人のユーザーが複数の会社のメンバーになれる。権限・利用停止は会社ごと(CompanyMember)。
// ログイン中にどの会社を開いているかはセッションに持つ(端末ごとに別の会社を開ける)。

// 開く会社を決める: 指定の会社 → 最初の会社(User.companyId) → ほかの会社 の順に、利用停止されていないもの
// メンバーの記録がまだないユーザー(最初の管理者・デモのユーザーなど)は、User の会社・権限から作る。
// ip を渡すと、IPアドレス制限でその場所から開けない会社は選ばない。
export async function pickMembership(user: { id: string; companyId: string; role: UserRole; active: boolean }, preferred: string | null, ip?: string | null) {
  const find = () =>
    prisma.companyMember.findMany({
      where: { userId: user.id },
      include: { company: { select: { name: true, require2fa: true, sessionIdleMinutes: true, allowedIps: true, loginAlert: true } } },
      orderBy: { createdAt: "asc" },
    });
  let members = await find();
  if (members.length === 0) {
    await prisma.companyMember.createMany({ data: [{ userId: user.id, companyId: user.companyId, role: user.role, active: user.active }], skipDuplicates: true });
    members = await find();
  }
  const usable = members.filter((m) => m.active && (ip === undefined || ipAllowed(ip, m.company.allowedIps)));
  return usable.find((m) => m.companyId === preferred) ?? usable.find((m) => m.companyId === user.companyId) ?? usable[0] ?? null;
}

export async function listMyCompanies(userId: string) {
  const members = await prisma.companyMember.findMany({
    where: { userId, active: true },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({ id: m.company.id, name: m.company.name, role: m.role }));
}

export async function switchCompany(sessionId: string, userId: string, companyId: string) {
  const member = await prisma.companyMember.findFirst({ where: { userId, companyId, active: true }, include: { company: { select: { name: true } } } });
  if (!member) throw new UserError("この会社は開けません");
  await prisma.session.update({ where: { id: sessionId }, data: { companyId } });
  return { id: companyId, name: member.company.name, role: member.role };
}

// 会社を追加する(追加した人がその会社の管理者になる)
export async function createCompany(userId: string, input: { name?: unknown; fiscalYearStartMonth?: unknown }) {
  const name = String(input.name ?? "").normalize("NFKC").trim().slice(0, 60);
  if (!name) throw new UserError("会社名(屋号)を入力してください");
  const month = input.fiscalYearStartMonth === undefined || input.fiscalYearStartMonth === "" ? 4 : Number(input.fiscalYearStartMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new UserError("決算期の始まりの月を選んでください");
  const mine = await prisma.companyMember.count({ where: { userId } });
  if (mine >= 20) throw new UserError("1人で入れる会社は20社までです");
  const company = await prisma.company.create({ data: { name, fiscalYearStartMonth: month, members: { create: { userId, role: "ADMIN" } } } });
  await ensureChartOfAccounts(company.id);
  return company;
}
