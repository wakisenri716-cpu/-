import type { RecordInput } from "@/lib/attendance/service";

export function recordInput(body: Record<string, unknown>): RecordInput {
  return {
    staffId: String(body.staffId ?? ""),
    date: String(body.date ?? ""),
    start: String(body.start ?? ""),
    end: String(body.end ?? ""),
    breakMinutes: Number(body.breakMinutes ?? 0),
  };
}
