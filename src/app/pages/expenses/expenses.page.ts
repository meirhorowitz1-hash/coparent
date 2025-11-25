import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CalendarService } from '../../core/services/calendar.service';
import {
  ExpenseRecord,
  ExpenseStoreService,
} from '../../core/services/expense-store.service';

@Component({
  selector: 'app-expenses',
  templateUrl: './expenses.page.html',
  styleUrls: ['./expenses.page.scss'],
  standalone: false,
})
export class ExpensesPage implements OnInit, OnDestroy {
  expenses: ExpenseRecord[] = [];
  expenseForm: FormGroup;
  pendingReceipt?: File;
  pendingReceiptPreview?: string;
  isSubmitting = false;
  private destroy$ = new Subject<void>();
  currentParentRole: 'parent1' | 'parent2' | null = null;

  constructor(
    private formBuilder: FormBuilder,
    private calendarService: CalendarService,
    private expenseStore: ExpenseStoreService,
    private toastCtrl: ToastController
  ) {
    const nowIso = new Date().toISOString();
    this.expenseForm = this.formBuilder.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      amount: ['', [Validators.required, Validators.min(1)]],
      date: [nowIso, Validators.required],
      notes: [''],
    });
  }

  ngOnInit() {
    this.expenseStore.expenses$
      .pipe(takeUntil(this.destroy$))
      .subscribe((expenses) => (this.expenses = expenses));

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const uid = this.calendarService.getCurrentUserId();
        this.currentParentRole = this.calendarService.getParentRoleForUser(uid);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get totalAmount(): number {
    return this.expenses.reduce((sum, item) => sum + item.amount, 0);
  }

  get canApproveExpenses(): boolean {
    // This logic might need adjustment based on final User/Family model
    return this.currentParentRole === 'parent2';
  }

  get groupedExpenses() {
    const buckets = new Map<
      string,
      { label: string; expenses: ExpenseRecord[]; monthIndex: number; year: number }
    >();

    this.expenses.forEach((expense) => {
      const date = new Date(expense.date); // Ensure it's a Date object
      const month = date.getMonth();
      const year = date.getFullYear();
      const key = `${year}-${month}`;
      if (!buckets.has(key)) {
        const label = date.toLocaleDateString('he-IL', {
          month: 'long',
          year: 'numeric',
        });
        buckets.set(key, { label, expenses: [], monthIndex: month, year });
      }
      buckets.get(key)!.expenses.push(expense);
    });

    return Array.from(buckets.entries())
      .map(([, bucket]) => {
        bucket.expenses.sort((a, b) => b.date.getTime() - a.date.getTime());
        return bucket;
      })
      .sort((a, b) => {
        if (a.year === b.year) {
          return b.monthIndex - a.monthIndex;
        }
        return b.year - a.year;
      });
  }

  getMonthlyReport(expenses: ExpenseRecord[]) {
    // This method may need to be updated depending on the final data structure from Firebase
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const approved = expenses.filter((e) => e.status === 'approved');
    const pending = expenses.filter((e) => e.status === 'pending');
    
    // The split calculation needs to be consistent with the model
    const parent1Share = approved.reduce((sum, e) => sum + this.calculateShare(e.amount, e.splitParent1), 0);
    const parent2Share = approved.reduce((sum, e) => sum + this.calculateShare(e.amount, 100 - e.splitParent1), 0);

    return {
      total,
      approvedTotal: approved.reduce((sum, e) => sum + e.amount, 0),
      pendingTotal: pending.reduce((sum, e) => sum + e.amount, 0),
      balance: parent1Share - parent2Share
    };
  }

  onReceiptSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.pendingReceipt = undefined;
      return;
    }
    const file = input.files[0];
    this.pendingReceipt = file;
    this.generatePreview(file);
    input.value = '';
  }

  private generatePreview(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      this.pendingReceiptPreview =
        typeof reader.result === 'string' ? reader.result : undefined;
    };
    reader.readAsDataURL(file);
  }

  removePendingReceipt() {
    this.pendingReceipt = undefined;
    this.pendingReceiptPreview = undefined;
  }

  async addExpense() {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    try {
      const { title, amount, notes } = this.expenseForm.value;
      const date = new Date(this.expenseForm.get('date')?.value || new Date());
      
      const expenseData = {
        title: title.trim(),
        amount: Number(amount),
        date,
        notes: notes?.trim(),
        splitParent1: 50, // Hardcoded 50/50 split for now
        receiptName: this.pendingReceipt?.name,
        receiptPreview: this.pendingReceiptPreview,
      };

      this.expenseStore.addExpense(expenseData);
      
      this.expenseForm.reset({ date: new Date().toISOString() });
      this.removePendingReceipt();

      const toast = await this.toastCtrl.create({
        message: 'ההוצאה נוספה בהצלחה',
        duration: 2000,
        color: 'success'
      });
      toast.present();
    } catch (error) {
      console.error('Failed to add expense:', error);
      const toast = await this.toastCtrl.create({
        message: 'שגיאה בהוספת ההוצאה',
        duration: 3000,
        color: 'danger'
      });
      toast.present();
    } finally {
      this.isSubmitting = false;
    }
  }

  formatCurrency(amount: number): string {
    return (amount ?? 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });
  }

  openReceipt(expense: ExpenseRecord) {
    if (expense.receiptPreview) {
      window.open(expense.receiptPreview, '_blank');
    }
  }

  async approveExpense(expense: ExpenseRecord, approved: boolean) {
    if (!this.canApproveExpenses) {
      return;
    }
    await this.expenseStore.setStatus(expense.id, approved ? 'approved' : 'rejected');
  }

  async markPaid(expense: ExpenseRecord) {
    await this.expenseStore.togglePaid(expense.id);
  }

  calculateShare(amount: number, percent: number): number {
    return (amount * percent) / 100;
  }
}
