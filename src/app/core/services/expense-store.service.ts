import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface ExpenseRecord {
  id: string;
  title: string;
  amount: number;
  date: Date;
  createdBy: string;
  createdByName?: string;
  notes?: string;
  receiptName?: string;
  receiptPreview?: string;
  splitParent1: number; // percentage (0-100)
  status: ExpenseStatus;
  isPaid: boolean;
  createdAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class ExpenseStoreService {
  private static readonly STORAGE_KEY = 'coparent:expenses';

  private expensesSubject = new BehaviorSubject<ExpenseRecord[]>(this.loadFromStorage());
  readonly expenses$ = this.expensesSubject.asObservable();

  addExpense(
    expense: Omit<ExpenseRecord, 'id' | 'createdAt' | 'status' | 'isPaid'> &
      Partial<Pick<ExpenseRecord, 'status' | 'isPaid' | 'id'>>
  ): ExpenseRecord {
    const record: ExpenseRecord = {
      ...expense,
      id: expense.id ?? crypto.randomUUID(),
      status: expense.status ?? 'pending',
      isPaid: expense.isPaid ?? false,
      createdBy: expense.createdBy ?? 'unknown',
      createdByName: expense.createdByName ?? 'הורה',
      createdAt: new Date(),
      date: new Date(expense.date),
      notes: expense.notes?.trim() || undefined,
      receiptName: expense.receiptName?.trim() || undefined
    };

    const next = [record, ...this.expensesSubject.value];
    this.expensesSubject.next(next);
    this.persist(next);
    return record;
  }

  setStatus(id: string, status: ExpenseStatus): void {
    this.patchExpense(id, current => ({
      status,
      isPaid: status === 'approved' ? current.isPaid : false
    }));
  }

  togglePaid(id: string): void {
    this.patchExpense(id, current => ({
      isPaid: !current.isPaid,
      status: current.status === 'approved' ? current.status : 'approved'
    }));
  }

  clear(): void {
    this.expensesSubject.next([]);
    this.persist([]);
  }

  getAll(): ExpenseRecord[] {
    return [...this.expensesSubject.value];
  }

  private patchExpense(
    id: string,
    updates: Partial<ExpenseRecord> | ((current: ExpenseRecord) => Partial<ExpenseRecord>)
  ): void {
    let changed = false;
    const next = this.expensesSubject.value.map(expense => {
      if (expense.id !== id) {
        return expense;
      }

      const patch = typeof updates === 'function' ? updates(expense) : updates;
      changed = true;
      return {
        ...expense,
        ...patch
      };
    });

    if (changed) {
      this.expensesSubject.next(next);
      this.persist(next);
    }
  }

  private persist(expenses: ExpenseRecord[]): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const serializable = expenses.map(expense => ({
        ...expense,
        date: expense.date.toISOString(),
        createdAt: expense.createdAt.toISOString()
      }));
      localStorage.setItem(ExpenseStoreService.STORAGE_KEY, JSON.stringify(serializable));
    } catch (error) {
      console.warn('Failed to persist expenses history', error);
    }
  }

  private loadFromStorage(): ExpenseRecord[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const raw = localStorage.getItem(ExpenseStoreService.STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as Array<
        Omit<ExpenseRecord, 'date' | 'createdAt'> & { date: string; createdAt: string }
      >;

      return parsed.map(expense => ({
        ...expense,
        date: new Date(expense.date),
        createdAt: new Date(expense.createdAt),
        createdBy: expense.createdBy ?? 'unknown',
        createdByName: expense.createdByName ?? 'הורה'
      }));
    } catch (error) {
      console.warn('Failed to read expenses history, starting fresh', error);
      return [];
    }
  }
}
