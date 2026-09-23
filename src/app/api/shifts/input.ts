import type { ShiftInput } from "@/lib/shifts/service";

export function shiftInput(body: Record<string, unknown>): ShiftInput {
  return {
    staffId: String(body.staffId ?? ""),
    date: String(body.date ?? ""),
    start: String(body.start ?? ""),
    end: String(body.end ?? ""),
    breakMinutes: Number(body.breakMinutes ?? 0),
    note: body.note ? String(body.note) : null,
  };
}
