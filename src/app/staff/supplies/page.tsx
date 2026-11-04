import { StaffSupplies } from "./StaffSupplies";

// 従業員: 備品・消耗品の購入依頼(?text= で「総務に頼む」から文を入れて開く)
export default async function Page({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const text = String((await searchParams).text ?? "").slice(0, 300);
  return <StaffSupplies initialText={text} />;
}
