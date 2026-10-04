import { requireMember } from "@/lib/auth/session";
import { StaffNav } from "@/components/StaffNav";

// スタッフアプリ(従業員がスマホで使う画面)。管理者・経理担当も同じ画面を確かめられる
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireMember();
  return (
    <div className="mx-auto max-w-2xl">
      <StaffNav />
      {children}
    </div>
  );
}
