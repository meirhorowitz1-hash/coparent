export interface Expense {
  id: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  date: Date;
  category: ExpenseCategory;
  paidBy: string; // user id
  splitType: SplitType;
  splitDetails?: ExpenseSplit[];
  status: ExpenseStatus;
  receipt?: string; // URL לקבלה
  approvedBy?: string[];
  createdAt: Date;
  updatedAt?: Date;
}

export enum ExpenseCategory {
  FOOD = 'food',                     // אוכל
  CLOTHING = 'clothing',             // ביגוד
  MEDICAL = 'medical',               // רפואי
  EDUCATION = 'education',           // חינוך
  ACTIVITIES = 'activities',         // פעילויות חוץ
  TRANSPORTATION = 'transportation', // תחבורה
  CHILDCARE = 'childcare',           // שמרטפות/בייביסיטר
  HOUSEHOLD = 'household',           // משק בית
  TOYS = 'toys',                     // צעצועים
  OTHER = 'other'
}

export enum SplitType {
  EQUAL = 'equal',           // שווה בשווה
  PERCENTAGE = 'percentage', // לפי אחוזים
  FIXED = 'fixed',           // סכום קבוע לכל אחד
  FULL = 'full'              // הכל על אחד
}

export enum ExpenseStatus {
  PENDING = 'pending',       // ממתין לאישור
  APPROVED = 'approved',     // אושר
  PAID = 'paid',             // שולם
  REJECTED = 'rejected'      // נדחה
}

export interface ExpenseSplit {
  userId: string;
  amount: number;
  percentage?: number;
  paid: boolean;
  paidAt?: Date;
}

export interface ExpenseSummary {
  totalExpenses: number;
  myShare: number;
  partnerShare: number;
  balance: number; // חיובי = אני חייב, שלילי = חייבים לי
  pendingApproval: number;
}
