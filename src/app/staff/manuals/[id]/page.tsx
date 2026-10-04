import { ManualView } from "./ManualView";

export default async function StaffManualPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManualView id={id} />;
}
