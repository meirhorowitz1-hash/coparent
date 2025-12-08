export interface PaymentReceipt {
  id: string;
  familyId?: string;
  month: number;        // 0-11
  year: number;
  imageUrl: string;     // base64 data URL or storage URL
  imageName?: string;
  description?: string;
  amount?: number;
  paidBy: string;       // user id
  paidByName?: string;
  paidTo: 'parent1' | 'parent2';
  createdAt: Date;
  updatedAt?: Date;
}

export interface MonthlyPaymentSummary {
  month: number;
  year: number;
  label: string;
  receipts: PaymentReceipt[];
  totalPaid: number;
}
