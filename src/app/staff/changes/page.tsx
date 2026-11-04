import { StaffChanges } from "./StaffChanges";

// 従業員: 身上の変更の届け出(?text= で「総務に頼む」から文を入れて開く)
export default async function Page({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const text = String((await searchParams).text ?? "").slice(0, 300);
  return <StaffChanges initialText={text} />;
}
