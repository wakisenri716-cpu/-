import { requireUser } from "@/lib/auth/session";
import { CompanyForm } from "./CompanyForm";
import { AddCompany } from "./AddCompany";
import { listMyCompanies } from "@/lib/auth/companies";
import { listClosures } from "@/lib/companyClosures";
import { jstDateKey } from "@/lib/jst";
import { ClosuresCard } from "./ClosuresCard";

export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">会社情報</h1>
        <p className="text-sm text-slate-600">この画面は管理者だけが使えます。</p>
      </div>
    );
  }
  const today = jstDateKey(new Date());
  const [companies, closures] = await Promise.all([listMyCompanies(user.id), listClosures(user.companyId, today)]);
  return (
    <div className="space-y-6">
      <CompanyForm key={user.companyId} />
      <ClosuresCard initial={closures.map((c) => ({ date: c.date, name: c.name }))} today={today} />
      <AddCompany companies={companies} />
    </div>
  );
}
