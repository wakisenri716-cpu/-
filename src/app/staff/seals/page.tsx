import { StaffSeals } from "./StaffSeals";

// 従業員: 押印の申請(?text= で「総務に頼む」から文を入れて開く)
export default async function Page({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const text = String((await searchParams).text ?? "").slice(0, 300);
  return <StaffSeals initialText={text} />;
}
