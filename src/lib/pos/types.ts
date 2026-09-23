export type NormalizedPosSale = {
  externalId: string;
  soldAt: Date;
  storeName: string | null;
  totalAmount: number;
  taxAmount: number;
  cashAmount: number;
  cashlessAmount: number;
};

const JST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toBusinessDate(date: Date): string {
  return JST_DATE.format(date);
}
