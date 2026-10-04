import { StockView } from "./StockView";

export default async function StaffStockPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams;
  return <StockView initialLow={sp.filter === "low"} />;
}
