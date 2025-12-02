import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ToastController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CalendarService } from '../../core/services/calendar.service';
import {
  ExpenseRecord,
  ExpenseStoreService,
  FinanceSettings,
  FixedExpenseSetting,
} from '../../core/services/expense-store.service';

type FixedExpenseFormGroup = FormGroup<{
  id: FormControl<string>;
  title: FormControl<string>;
  amount: FormControl<number>;
  splitParent1: FormControl<number>;
}>;

interface MonthlyReport {
  total: number;
  approvedTotal: number;
  pendingTotal: number;
  parent1Share: number;
  parent2Share: number;
  alimonyAmount: number;
  alimonyPayer: 'parent1' | 'parent2' | null;
  balance: number;
}

@Component({
  selector: 'app-expenses',
  templateUrl: './expenses.page.html',
  styleUrls: ['./expenses.page.scss'],
  standalone: false,
})
export class ExpensesPage implements OnInit, OnDestroy {
  expenses: ExpenseRecord[] = [];
  expenseForm: FormGroup;
  alimonyForm: FormGroup;
  editingExpenseId: string | null = null;
  showAddForm = false;
  pendingReceipt?: File;
  pendingReceiptPreview?: string;
  isSubmitting = false;
  isSavingSettings = false;
  private destroy$ = new Subject<void>();
  currentParentRole: 'parent1' | 'parent2' | null = null;
  currentUserId: string | null = null;
  currentUserName: string = 'הורה';
  parentNames = {
    parent1: 'הורה 1',
    parent2: 'הורה 2'
  };
  financeSettings: FinanceSettings = {
    alimonyAmount: 0,
    alimonyPayer: null,
    defaultSplitParent1: 50,
    fixedExpenses: []
  };
  paymentBreakdowns:
    | Array<{
        label: string;
        report: MonthlyReport;
        expenses: ExpenseRecord[];
      }>
    | null = null;
  paymentModalOpen = false;
  pendingModalOpen = false;
  settingsModalOpen = false;
  summaryModalOpen = false;
  private pendingOpenSummary = false;

  constructor(
    private formBuilder: FormBuilder,
    private calendarService: CalendarService,
    private expenseStore: ExpenseStoreService,
    private toastCtrl: ToastController,
    private route: ActivatedRoute
  ) {
    const nowIso = new Date().toISOString();
    this.expenseForm = this.formBuilder.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      amount: ['', [Validators.required, Validators.min(1)]],
      date: [nowIso, Validators.required],
      notes: [''],
      splitParent1: [50, [Validators.required, Validators.min(0), Validators.max(100)]]
    });

    this.alimonyForm = this.formBuilder.group({
      alimonyAmount: [0, [Validators.min(0)]],
      alimonyPayer: [null],
      defaultSplitParent1: [50, [Validators.min(0), Validators.max(100)]],
      fixedExpenses: this.formBuilder.array<FixedExpenseFormGroup>([])
    });
  }

  ngOnInit() {
    this.expenseStore.expenses$
      .pipe(takeUntil(this.destroy$))
      .subscribe((expenses) => {
        this.expenses = expenses;
        if (this.pendingOpenSummary) {
          this.pendingOpenSummary = false;
          this.openSummaryModal();
        }
      });

    this.expenseStore.financeSettings$
      .pipe(takeUntil(this.destroy$))
      .subscribe(settings => {
        this.financeSettings = settings;
        this.resetFixedExpensesForm(settings.fixedExpenses || []);
        this.alimonyForm.patchValue(
          {
            alimonyAmount: settings.alimonyAmount,
            alimonyPayer: settings.alimonyPayer,
            defaultSplitParent1: settings.defaultSplitParent1
          },
          { emitEvent: false }
        );
        this.expenseForm.patchValue({ splitParent1: settings.defaultSplitParent1 }, { emitEvent: false });
      });

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        const uid = this.calendarService.getCurrentUserId();
        this.currentUserId = uid;
        this.currentParentRole = this.calendarService.getParentRoleForUser(uid);
        this.currentUserName = this.calendarService.getCurrentUserDisplayName();
        this.parentNames = {
          parent1: metadata.parent1.name || 'הורה 1',
          parent2: metadata.parent2.name || 'הורה 2'
        };
      });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const openSummary = params.get('openSummary');
      if (openSummary === 'true' || openSummary === '') {
        this.pendingOpenSummary = true;
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get totalAmount(): number {
    return this.approvedExpenses.reduce((sum, item) => sum + item.amount, 0);
  }

  get pendingTotal(): number {
    return this.pendingExpenses.reduce((sum, item) => sum + item.amount, 0);
  }

  get approvedExpenses(): ExpenseRecord[] {
    return this.expenses.filter(expense => expense.status === 'approved');
  }

  get pendingExpenses(): ExpenseRecord[] {
    return this.expenses.filter(expense => expense.status === 'pending');
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

    const addExpenseToBucket = (expense: ExpenseRecord, month: number, year: number) => {
      const key = `${year}-${month}`;
      if (!buckets.has(key)) {
        const baseDate = new Date(year, month, 1);
        const label = baseDate.toLocaleDateString('he-IL', {
          month: 'long',
          year: 'numeric',
        });
        buckets.set(key, { label, expenses: [], monthIndex: month, year });
      }
      buckets.get(key)!.expenses.push(expense);
    };

    this.expenses.forEach((expense) => {
      const date = new Date(expense.date);
      const month = date.getMonth();
      const year = date.getFullYear();
      addExpenseToBucket(expense, month, year);
    });

    // אם אין הוצאות כלל אבל יש הוצאות קבועות, ניצור חודש נוכחי כדי להציגן
    if (buckets.size === 0 && this.financeSettings.fixedExpenses?.length) {
      const now = new Date();
      addExpenseToBucket(
        this.buildFixedExpenseRecord(
          this.financeSettings.fixedExpenses[0],
          now.getMonth(),
          now.getFullYear()
        ),
        now.getMonth(),
        now.getFullYear()
      );
    }

    buckets.forEach(bucket => {
      (this.financeSettings.fixedExpenses ?? []).forEach(fixed =>
        bucket.expenses.push(this.buildFixedExpenseRecord(fixed, bucket.monthIndex, bucket.year))
      );
      bucket.expenses.sort((a, b) => b.date.getTime() - a.date.getTime());
    });

    return Array.from(buckets.entries())
      .map(([, bucket]) => bucket)
      .sort((a, b) => {
        if (a.year === b.year) {
          return b.monthIndex - a.monthIndex;
        }
        return b.year - a.year;
      });
  }

  getMonthlyReport(expenses: ExpenseRecord[]): MonthlyReport {
    // This method may need to be updated depending on the final data structure from Firebase
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const approved = expenses.filter((e) => e.status === 'approved');
    const pending = expenses.filter((e) => e.status === 'pending');
    
    // The split calculation needs to be consistent with the model
    const parent1Share = approved.reduce((sum, e) => sum + this.calculateShare(e.amount, e.splitParent1), 0);
    const parent2Share = approved.reduce(
      (sum, e) => sum + this.calculateShare(e.amount, 100 - e.splitParent1),
      0
    );

    const alimonyAmount = this.financeSettings.alimonyAmount || 0;
    const alimonyPayer = this.financeSettings.alimonyPayer;
    const alimonyEffect =
      alimonyPayer === 'parent1' ? alimonyAmount : alimonyPayer === 'parent2' ? -alimonyAmount : 0;

    const balance = parent1Share - parent2Share + alimonyEffect;

    return {
      total,
      approvedTotal: approved.reduce((sum, e) => sum + e.amount, 0),
      pendingTotal: pending.reduce((sum, e) => sum + e.amount, 0),
      balance,
      parent1Share,
      parent2Share,
      alimonyAmount,
      alimonyPayer
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

  cancelEdit() {
    this.editingExpenseId = null;
    this.expenseForm.reset({
      date: new Date().toISOString(),
      splitParent1: this.financeSettings.defaultSplitParent1
    });
    this.removePendingReceipt();
    this.showAddForm = false;
  }

  editExpense(expense: ExpenseRecord) {
    if (expense.status !== 'pending') {
      return;
    }
    this.editingExpenseId = expense.id;
    this.expenseForm.patchValue({
      title: expense.title,
      amount: expense.amount,
      date: expense.date.toISOString(),
      notes: expense.notes || '',
      splitParent1: expense.splitParent1
    });
    this.pendingReceipt = undefined;
    this.pendingReceiptPreview = expense.receiptPreview;
  }

  async deleteExpense(expense: ExpenseRecord) {
    if (expense.status !== 'pending') {
      return;
    }
    const confirmed = window.confirm('למחוק את ההוצאה הזו?');
    if (!confirmed) {
      return;
    }
    try {
      await this.expenseStore.deleteExpense(expense.id);
      const toast = await this.toastCtrl.create({
        message: 'ההוצאה נמחקה',
        duration: 2000,
        color: 'medium'
      });
      toast.present();
      if (this.editingExpenseId === expense.id) {
        this.editingExpenseId = null;
        this.expenseForm.reset({ date: new Date().toISOString(), splitParent1: this.financeSettings.defaultSplitParent1 });
        this.pendingReceipt = undefined;
        this.pendingReceiptPreview = undefined;
      }
    } catch (error) {
      console.error('Failed to delete expense', error);
      const toast = await this.toastCtrl.create({
        message: 'לא הצלחנו למחוק, נסו שוב',
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    }
  }

  async addExpense() {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    try {
      const isEdit = !!this.editingExpenseId;
      const { title, amount, notes, splitParent1 } = this.expenseForm.value;
      const date = new Date(this.expenseForm.get('date')?.value || new Date());
      const normalizedSplit = Math.min(100, Math.max(0, Number(splitParent1) || 0));
      
      const expenseData = {
        title: title.trim(),
        amount: Number(amount),
        date,
        notes: notes?.trim(),
        createdBy: this.currentUserId || 'anonymous',
        createdByName: this.currentUserName || 'הורה',
        splitParent1: normalizedSplit,
        receiptName: this.pendingReceipt?.name,
        receiptPreview: this.pendingReceiptPreview,
      };

      if (this.editingExpenseId) {
        await this.expenseStore.updateExpense(this.editingExpenseId, expenseData);
      } else {
        await this.expenseStore.addExpense(expenseData);
      }

      this.expenseForm.reset({ date: new Date().toISOString() });
      this.expenseForm.patchValue({ splitParent1: normalizedSplit });
      this.removePendingReceipt();
      this.editingExpenseId = null;
      if (!isEdit) {
        this.showAddForm = false;
      }

      const toast = await this.toastCtrl.create({
        message: isEdit ? 'ההוצאה עודכנה' : 'ההוצאה נוספה בהצלחה',
        duration: 2000,
        color: 'success'
      });
      toast.present();
    } catch (error: any) {
      console.error('Failed to add expense:', error);
      const message =
        error?.message === 'missing-family-context'
          ? 'אין משפחה פעילה מחוברת כרגע'
          : error?.message === 'cannot-edit-non-pending'
            ? 'ניתן לערוך רק הוצאה שממתינה לאישור'
            : 'שגיאה בהוספת ההוצאה';
      const toast = await this.toastCtrl.create({
        message,
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
    try {
      await this.expenseStore.setStatus(expense.id, approved ? 'approved' : 'rejected');
    } catch (error) {
      console.error('Failed to update expense status', error);
      const toast = await this.toastCtrl.create({
        message: 'לא הצלחנו לעדכן את ההוצאה, נסו שוב',
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    }
  }

  async markPaid(expense: ExpenseRecord) {
    try {
      await this.expenseStore.togglePaid(expense.id);
    } catch (error) {
      console.error('Failed to mark expense as paid', error);
      const toast = await this.toastCtrl.create({
        message: 'לא הצלחנו לעדכן את התשלום, נסו שוב',
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    }
  }

  calculateShare(amount: number, percent: number): number {
    return (amount * percent) / 100;
  }

  async saveFinanceSettings() {
    if (this.alimonyForm.invalid) {
      this.alimonyForm.markAllAsTouched();
      return;
    }

    this.isSavingSettings = true;
    try {
      const { alimonyAmount, alimonyPayer, defaultSplitParent1, fixedExpenses } = this.alimonyForm.value;
      await this.expenseStore.updateFinanceSettings({
        alimonyAmount: Number(alimonyAmount) || 0,
        alimonyPayer: alimonyPayer || null,
        defaultSplitParent1: Number(defaultSplitParent1) || 0,
        fixedExpenses: (fixedExpenses as any[]).map(item => ({
          id: item.id || crypto.randomUUID(),
          title: (item.title || '').trim(),
          amount: Number(item.amount) || 0,
          splitParent1: Number(item.splitParent1) || 0
        }))
      });
      this.expenseForm.patchValue({ splitParent1: Number(defaultSplitParent1) || 0 });
      const toast = await this.toastCtrl.create({
        message: 'הגדרות נשמרו',
        duration: 2000,
        color: 'success'
      });
      toast.present();
    } catch (error) {
      console.error('Failed to save finance settings', error);
      const toast = await this.toastCtrl.create({
        message: 'לא הצלחנו לשמור הגדרות',
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    } finally {
      this.isSavingSettings = false;
    }
  }

  getParentShareLabel(role: 'parent1' | 'parent2'): string {
    return this.parentNames[role] || (role === 'parent1' ? 'הורה 1' : 'הורה 2');
  }

  getShareForRole(role: 'parent1' | 'parent2'): number {
    const split = Number(this.expenseForm.value.splitParent1) || 0;
    return role === 'parent1' ? split : 100 - split;
  }

  getCurrentUserShareLabel(): string {
    const role = this.currentParentRole || 'parent1';
    return `${this.getShareForRole(role)}% ${this.getParentShareLabel(role)}`;
  }

  private buildFixedExpenseRecord(fixed: FixedExpenseSetting, month: number, year: number): ExpenseRecord {
    const baseDate = new Date(year, month, 1);
    return {
      id: `fixed-${fixed.id}-${year}-${month}`,
      title: fixed.title,
      amount: fixed.amount,
      date: baseDate,
      createdBy: 'system',
      createdByName: 'הוצאה קבועה',
      notes: 'הוצאה קבועה',
      receiptName: undefined,
      receiptPreview: undefined,
      splitParent1: typeof fixed.splitParent1 === 'number' ? fixed.splitParent1 : this.financeSettings.defaultSplitParent1,
      status: 'approved',
      isPaid: false,
      createdAt: baseDate
    };
  }

  openPaymentModal() {
    this.paymentBreakdowns = this.groupedExpenses.map(bucket => ({
      label: bucket.label,
      report: this.getMonthlyReport(bucket.expenses),
      expenses: bucket.expenses
    }));
    this.paymentModalOpen = true;
  }

  openPendingModal() {
    this.pendingModalOpen = true;
  }

  closePendingModal() {
    this.pendingModalOpen = false;
  }

  openSummaryModal() {
    if (!this.groupedExpenses.length) {
      return;
    }
    this.summaryModalOpen = true;
  }

  closeSummaryModal() {
    this.summaryModalOpen = false;
  }

  closePaymentModal() {
    this.paymentModalOpen = false;
    this.paymentBreakdowns = null;
  }

  getPaymentMessage(report: MonthlyReport): string {
    if (report.balance === 0) {
      return 'אין העברת כספים החודש';
    }

    const payer = report.balance > 0 ? 'parent1' : 'parent2';
    const receiver = payer === 'parent1' ? 'parent2' : 'parent1';
    const amount = Math.abs(report.balance);
    const payerName = this.parentNames[payer];
    const receiverName = this.parentNames[receiver];

    if (this.currentParentRole === payer) {
      return `אתה צריך להעביר ל${receiverName} ${this.formatCurrency(amount)}`;
    }

    if (this.currentParentRole === receiver) {
      return `${payerName} צריך להעביר לך ${this.formatCurrency(amount)}`;
    }

    return `${payerName} צריך להעביר ל${receiverName} ${this.formatCurrency(amount)}`;
  }

  openSettingsModal() {
    this.settingsModalOpen = true;
  }

  closeSettingsModal() {
    this.settingsModalOpen = false;
  }

  get fixedExpensesArray(): FormArray {
    return this.alimonyForm.get('fixedExpenses') as FormArray<FixedExpenseFormGroup>;
  }

  get fixedExpenseGroups(): FixedExpenseFormGroup[] {
    return this.fixedExpensesArray.controls as FixedExpenseFormGroup[];
  }

  private resetFixedExpensesForm(items: FixedExpenseSetting[]) {
    const array = this.formBuilder.array<FixedExpenseFormGroup>([]);
    items.forEach(item => array.push(this.buildFixedExpenseGroup(item)));
    this.alimonyForm.setControl('fixedExpenses', array);
  }

  addFixedExpenseRow() {
    this.fixedExpensesArray.push(
      this.buildFixedExpenseGroup({
        id: crypto.randomUUID(),
        title: '',
        amount: 0,
        splitParent1: this.financeSettings.defaultSplitParent1 || 50
      })
    );
  }

  removeFixedExpense(index: number) {
    if (index >= 0 && index < this.fixedExpensesArray.length) {
      this.fixedExpensesArray.removeAt(index);
    }
  }

  private buildFixedExpenseGroup(item: FixedExpenseSetting): FixedExpenseFormGroup {
    return this.formBuilder.group({
      id: new FormControl<string>(item.id || crypto.randomUUID(), { nonNullable: true }),
      title: new FormControl<string>(item.title || '', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2)]
      }),
      amount: new FormControl<number>(item.amount ?? 0, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0)]
      }),
      splitParent1: new FormControl<number>(item.splitParent1 ?? this.financeSettings.defaultSplitParent1 ?? 50, {
        nonNullable: true,
        validators: [Validators.min(0), Validators.max(100)]
      })
    });
  }

  isFixedExpense(expense: ExpenseRecord): boolean {
    return expense.id.startsWith('fixed-');
  }
}
