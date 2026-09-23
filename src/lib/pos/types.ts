export type NormalizedPosSale = {
  externalId: string;
  soldAt: Date;
  storeName: string | null;
  totalAmount: number;
  taxAmount: number;
  cashAmount: number;
  cashlessAmount: number;
};
