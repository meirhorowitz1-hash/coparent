import { Component, OnDestroy, OnInit, ViewChild, ElementRef, ViewChildren, QueryList } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ToastController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CalendarService } from '../../core/services/calendar.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  ExpenseRecord,
  ExpenseStoreService,
  FinanceSettings,
  FixedExpenseSetting,
} from '../../core/services/expense-store.service';
import { PaymentReceiptService } from '../../core/services/payment-receipt.service';
import { PaymentReceipt, MonthlyPaymentSummary } from '../../core/models/payment-receipt.model';

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
  @ViewChild('expensesSection', { read: ElementRef }) expensesSection?: ElementRef;

  // הוספת Math לתבנית
  Math = Math;

  expenses: ExpenseRecord[] = [];
  expenseForm: FormGroup;
  alimonyForm: FormGroup;
  editingExpenseId: string | null = null;
  pendingReceipt?: File;
  pendingReceiptPreview?: string;
  @ViewChildren('receiptContent') receiptContent!: QueryList<ElementRef<HTMLElement>>;
  private readonly MAX_RECEIPT_PREVIEW_BYTES = 900_000;
  isSubmitting = false;
  isSavingSettings = false;
  private destroy$ = new Subject<void>();
  currentParentRole: 'parent1' | 'parent2' | null = null;
  currentUserId: string | null = null;
  currentUserName: string | null = null;
  parentNames = {
    parent1: '',
    parent2: ''
  };
  parentUids: { parent1: string | null; parent2: string | null } = {
    parent1: null,
    parent2: null
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
  settingsModalOpen = false;
  addExpenseModalOpen = false;

  // Payment Receipts
  paymentReceiptModalOpen = false;
  paymentReceiptForm: FormGroup;
  pendingPaymentReceiptFile?: File;
  pendingPaymentReceiptPreview?: string;
  isUploadingReceipt = false;
  paymentReceiptsByMonth: MonthlyPaymentSummary[] = [];
  viewingReceipt: PaymentReceipt | null = null;

  constructor(
    private formBuilder: FormBuilder,
    private calendarService: CalendarService,
    private expenseStore: ExpenseStoreService,
    private paymentReceiptService: PaymentReceiptService,
    private toastCtrl: ToastController,
    private route: ActivatedRoute,
    public i18n: I18nService
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

    // Payment Receipt Form
    this.paymentReceiptForm = this.formBuilder.group({
      monthYear: [nowIso, Validators.required],
      amount: [null, [Validators.min(0)]],
      paidTo: ['parent2', Validators.required],
      description: ['']
    });
  }

  ngOnInit() {
    this.expenseStore.expenses$
      .pipe(takeUntil(this.destroy$))
      .subscribe((expenses) => {
        this.expenses = expenses;
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
        this.currentUserName = this.calendarService.getCurrentUserDisplayName() || null;
        this.parentNames = {
          parent1: metadata.parent1.name || '',
          parent2: metadata.parent2.name || ''
        };
        this.parentUids = {
          parent1: metadata.parent1.uid || null,
          parent2: metadata.parent2.uid || null
        };
      });

    // Subscribe to payment receipts
    this.paymentReceiptService.receipts$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.paymentReceiptsByMonth = this.paymentReceiptService.getGroupedByMonth();
      });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(() => {});
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  scrollToExpenses() {
    if (this.expensesSection) {
      this.expensesSection.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  openAddExpenseModal() {
    this.addExpenseModalOpen = true;
  }

  closeAddExpenseModal() {
    this.addExpenseModalOpen = false;
    if (!this.editingExpenseId) {
      this.expenseForm.reset({
        date: new Date().toISOString(),
        splitParent1: this.financeSettings.defaultSplitParent1
      });
      this.removePendingReceipt();
    }
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
        const label = baseDate.toLocaleDateString(this.i18n.locale, {
          month: 'long',
          year: 'numeric'
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
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const approved = expenses.filter(e => e.status === 'approved');
    const pending = expenses.filter(e => e.status === 'pending');

    let parent1Share = 0;
    let parent2Share = 0;
    let balance = 0;

    approved.forEach(expense => {
      const share1 = this.calculateShare(expense.amount, expense.splitParent1);
      const share2 = expense.amount - share1;
      parent1Share += share1;
      parent2Share += share2;

      const payer = this.resolvePayerRole(expense);
      if (payer === 'parent1') {
        balance -= share2;
      } else if (payer === 'parent2') {
        balance += share1;
      }
    });

    const alimonyAmount = this.financeSettings.alimonyAmount || 0;
    const alimonyPayer = this.financeSettings.alimonyPayer;
    if (alimonyPayer === 'parent1') {
      balance += alimonyAmount;
    } else if (alimonyPayer === 'parent2') {
      balance -= alimonyAmount;
    }

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

  async onReceiptSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.pendingReceipt = undefined;
      return;
    }
    const file = input.files[0];
    this.pendingReceipt = file;
    await this.generatePreview(file);
    input.value = '';
  }

  private async generatePreview(file: File) {
    if (!file.type.startsWith('image/')) {
      this.pendingReceiptPreview = undefined;
      return;
    }

    try {
      const compressed = await this.compressImage(file, 1400, 0.72);
      if (compressed && this.getDataUrlSize(compressed) <= this.MAX_RECEIPT_PREVIEW_BYTES) {
        this.pendingReceiptPreview = compressed;
      } else {
        this.pendingReceiptPreview = undefined;
        this.pendingReceipt = undefined;
        await this.showReceiptTooLargeToast();
      }
    } catch (error) {
      console.error('Failed to generate receipt preview', error);
      this.pendingReceiptPreview = undefined;
      this.pendingReceipt = undefined;
      await this.showReceiptTooLargeToast(true);
    }
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
    this.closeAddExpenseModal();
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
    this.openAddExpenseModal();
  }

  async deleteExpense(expense: ExpenseRecord) {
    if (expense.status !== 'pending') {
      return;
    }
    const confirmed = window.confirm(this.i18n.translate('expenses.confirm.delete'));
    if (!confirmed) {
      return;
    }
    try {
      await this.expenseStore.deleteExpense(expense.id);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.deleteSuccess'),
        duration: 2000,
        color: 'medium'
      });
      toast.present();
      if (this.editingExpenseId === expense.id) {
        this.cancelEdit();
      }
    } catch (error) {
      console.error('Failed to delete expense', error);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.deleteFailed'),
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
        createdByName: this.getCurrentUserLabel(),
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
      this.closeAddExpenseModal();

      const toast = await this.toastCtrl.create({
        message: isEdit
          ? this.i18n.translate('expenses.toast.updated')
          : this.i18n.translate('expenses.toast.added'),
        duration: 2000,
        color: 'success'
      });
      toast.present();
    } catch (error: any) {
      console.error('Failed to add expense:', error);
      const message =
        error?.message === 'missing-family-context'
          ? this.i18n.translate('expenses.toast.missingFamily')
          : error?.message === 'cannot-edit-non-pending'
            ? this.i18n.translate('expenses.toast.cannotEdit')
            : this.i18n.translate('expenses.toast.addError');
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
    return (amount ?? 0).toLocaleString(this.i18n.locale, { style: 'currency', currency: 'ILS' });
  }

  openReceipt(expense: ExpenseRecord) {
    if (expense.receiptPreview) {
      this.openReceiptUrl(expense.receiptPreview);
    }
  }

  openReceiptPreview() {
    if (this.pendingReceiptPreview) {
      this.openReceiptUrl(this.pendingReceiptPreview);
    }
  }

  private openReceiptUrl(url: string) {
    const objectUrl = this.dataUrlToObjectUrl(url) || url;
    const win = window.open(objectUrl, '_blank');
    if (!win) {
      this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.receiptOpenFailed'),
        duration: 2500,
        color: 'warning'
      }).then(t => t.present());
    }
  }

  private dataUrlToObjectUrl(dataUrl: string): string | null {
    if (!dataUrl.startsWith('data:')) {
      return null;
    }
    const parts = dataUrl.split(',');
    if (parts.length < 2) {
      return null;
    }
    try {
      const mime = parts[0].split(':')[1].split(';')[0] || 'application/octet-stream';
      const byteString = atob(parts[1]);
      const arrayBuffer = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(arrayBuffer);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([arrayBuffer], { type: mime });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Failed to convert data URL', error);
      return null;
    }
  }

  async approveExpense(expense: ExpenseRecord, approved: boolean) {
    // Only the non-creator can approve/reject
    if (this.isExpenseCreator(expense)) {
      return;
    }
    
    try {
      await this.expenseStore.setStatus(expense.id, approved ? 'approved' : 'rejected');
    } catch (error) {
      console.error('Failed to update expense status', error);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.updateFailed'),
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    }
  }

  isExpenseCreator(expense: ExpenseRecord): boolean {
    return expense.createdBy === this.currentUserId;
  }

  async markPaid(expense: ExpenseRecord) {
    try {
      await this.expenseStore.togglePaid(expense.id);
    } catch (error) {
      console.error('Failed to mark expense as paid', error);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.markPaidFailed'),
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    }
  }

  calculateShare(amount: number, percent: number): number {
    return (amount * percent) / 100;
  }

  private resolvePayerRole(expense: ExpenseRecord): 'parent1' | 'parent2' | null {
    const { parent1, parent2 } = this.parentUids;
    if (parent1 && expense.createdBy === parent1) {
      return 'parent1';
    }
    if (parent2 && expense.createdBy === parent2) {
      return 'parent2';
    }
    return null;
  }

  getParentDisplayName(role: 'parent1' | 'parent2' | null | undefined): string {
    return this.getParentLabel(role);
  }

  getParentLabel(role: 'parent1' | 'parent2' | null | undefined): string {
    if (role === 'parent1' || role === 'parent2') {
      const name = this.parentNames[role];
      if (name) {
        return name;
      }
      return this.i18n.translate(role === 'parent1' ? 'profile.parent1' : 'profile.parent2');
    }
    return this.i18n.translate('expenses.defaultParent');
  }

  private getCurrentUserLabel(): string {
    return this.currentUserName || this.i18n.translate('expenses.defaultParent');
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
        message: this.i18n.translate('expenses.toast.settingsSaved'),
        duration: 2000,
        color: 'success'
      });
      toast.present();
    } catch (error) {
      console.error('Failed to save finance settings', error);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.settingsFailed'),
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    } finally {
      this.isSavingSettings = false;
    }
  }

  getParentShareLabel(role: 'parent1' | 'parent2'): string {
    return this.getParentLabel(role);
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
      createdByName: this.i18n.translate('expenses.fixedExpenseLabel'),
      notes: this.i18n.translate('expenses.fixedExpenseLabel'),
      receiptName: undefined,
      receiptPreview: undefined,
      splitParent1: typeof fixed.splitParent1 === 'number' ? fixed.splitParent1 : this.financeSettings.defaultSplitParent1,
      status: 'approved',
      isPaid: false,
      createdAt: baseDate
    };
  }

  openPaymentModal() {
    const buckets = this.groupedExpenses;

    if (!buckets.length && (this.financeSettings.alimonyAmount || 0) > 0) {
      const now = new Date();
      const label = now.toLocaleDateString(this.i18n.locale, { month: 'long', year: 'numeric' });
      this.paymentBreakdowns = [
        {
          label,
          report: this.getMonthlyReport([]),
          expenses: []
        }
      ];
    } else {
      this.paymentBreakdowns = buckets.map(bucket => {
        const approvedExpenses = bucket.expenses.filter(expense => expense.status === 'approved');
        return {
          label: bucket.label,
          report: this.getMonthlyReport(approvedExpenses),
          expenses: approvedExpenses
        };
      });
    }

    this.paymentModalOpen = true;
  }

  closePaymentModal() {
    this.paymentModalOpen = false;
    this.paymentBreakdowns = null;
  }

  get currentMonthBucket() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    return this.groupedExpenses.find(bucket => bucket.monthIndex === month && bucket.year === year);
  }

  get currentMonthExpenses(): ExpenseRecord[] {
    return this.currentMonthBucket?.expenses ?? [];
  }

  get currentMonthLabel(): string {
    if (this.currentMonthBucket?.label) {
      return this.currentMonthBucket.label;
    }
    const now = new Date();
    return now.toLocaleDateString(this.i18n.locale, { month: 'long', year: 'numeric' });
  }

  get currentMonthReport(): MonthlyReport | null {
    const expenses = this.currentMonthExpenses;
    if (!expenses.length) {
      return null;
    }
    return this.getMonthlyReport(expenses);
  }

  getPaymentMessage(report: MonthlyReport): string {
    if (report.balance === 0) {
      return this.i18n.translate('expenses.payment.none');
    }

    const payer = report.balance > 0 ? 'parent1' : 'parent2';
    const receiver = payer === 'parent1' ? 'parent2' : 'parent1';
    const amount = Math.abs(report.balance);
    const formattedAmount = this.formatCurrency(amount);
    const payerName = this.getParentLabel(payer);
    const receiverName = this.getParentLabel(receiver);

    if (this.currentParentRole === payer) {
      return this.i18n.translate('expenses.payment.youOwe', {
        receiver: receiverName,
        amount: formattedAmount
      });
    }

    if (this.currentParentRole === receiver) {
      return this.i18n.translate('expenses.payment.theyOweYou', {
        payer: payerName,
        amount: formattedAmount
      });
    }

    return this.i18n.translate('expenses.payment.transferBetweenParents', {
      payer: payerName,
      receiver: receiverName,
      amount: formattedAmount
    });
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

  private async showReceiptTooLargeToast(includeError: boolean = false) {
    const messageKey = includeError
      ? 'expenses.toast.receiptTooLargeDetailed'
      : 'expenses.toast.receiptTooLargeFallback';
    const toast = await this.toastCtrl.create({
      message: this.i18n.translate(messageKey),
      duration: 3000,
      color: 'warning'
    });
    toast.present();
  }

  private getDataUrlSize(dataUrl: string): number {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  }

  private compressImage(file: File, maxDimension: number, quality: number): Promise<string | undefined> {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          resolve(undefined);
          return;
        }
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxDimension / Math.max(width, height));
          width *= scale;
          height *= scale;

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(typeof reader.result === 'string' ? reader.result : undefined);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = () => resolve(undefined);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  }

  getCurrentDate(): string {
    const now = new Date();
    return now.toLocaleDateString(this.i18n.locale, { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  }

  getCurrentDateTime(): string {
    const now = new Date();
    return now.toLocaleString(this.i18n.locale, { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getCategorizedExpenses(expenses: ExpenseRecord[]): Array<{ name: string; total: number; parent1Share: number; parent2Share: number }> {
    // קבוצת הוצאות לפי שם (קטגוריה)
    const categories = new Map<string, { total: number; parent1Share: number; parent2Share: number }>();

    expenses.forEach(expense => {
      const categoryName = expense.title;
      const share1 = this.calculateShare(expense.amount, expense.splitParent1);
      const share2 = expense.amount - share1;

      if (categories.has(categoryName)) {
        const existing = categories.get(categoryName)!;
        existing.total += expense.amount;
        existing.parent1Share += share1;
        existing.parent2Share += share2;
      } else {
        categories.set(categoryName, {
          total: expense.amount,
          parent1Share: share1,
          parent2Share: share2
        });
      }
    });

    // המרה למערך
    return Array.from(categories.entries()).map(([name, data]) => ({
      name,
      ...data
    }));
  }

  getExpensePaidByName(expense: ExpenseRecord): string {
    const { parent1, parent2 } = this.parentUids;
    
    if (expense.createdBy === parent1) {
      return this.getParentLabel('parent1');
    }
    
    if (expense.createdBy === parent2) {
      return this.getParentLabel('parent2');
    }
    
    return expense.createdByName || this.i18n.translate('expenses.unknownPayer');
  }

  getParentUidByRole(role: 'parent1' | 'parent2'): string | null {
    return this.parentUids[role];
  }

  getDetailedCalculation(expenses: ExpenseRecord[]): {
    parent1: { totalPaid: number; balance: number };
    parent2: { totalPaid: number; balance: number };
  } {
    let parent1Paid = 0;
    let parent2Paid = 0;
    let parent1Share = 0;
    let parent2Share = 0;

    const parent1Uid = this.parentUids.parent1;
    const parent2Uid = this.parentUids.parent2;

    expenses.forEach(expense => {
      const share1 = this.calculateShare(expense.amount, expense.splitParent1);
      const share2 = expense.amount - share1;

      parent1Share += share1;
      parent2Share += share2;

      // מי שילם בפועל
      if (expense.createdBy === parent1Uid) {
        parent1Paid += expense.amount;
      } else if (expense.createdBy === parent2Uid) {
        parent2Paid += expense.amount;
      }
    });

    // חישוב היתרה: שילם פחות צריך לשלם
    // אם חיובי - חייבים לו
    // אם שלילי - הוא חייב
    const parent1Balance = parent1Paid - parent1Share;
    const parent2Balance = parent2Paid - parent2Share;

    return {
      parent1: {
        totalPaid: parent1Paid,
        balance: parent1Balance
      },
      parent2: {
        totalPaid: parent2Paid,
        balance: parent2Balance
      }
    };
  }

  async downloadReceipt() {
    const section = this.receiptContent?.first?.nativeElement;
    if (!section) {
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.noDataToDownload'),
        duration: 2000,
        color: 'warning'
      });
      toast.present();
      return;
    }

    const tableHtml = section.querySelector('.table-wrap')?.innerHTML || '';
    const balanceEl = section.querySelector('.final-balance');
    const balanceText = balanceEl ? balanceEl.textContent?.trim() || '' : '';

    const style = `
      <style>
        body { direction: rtl; font-family: Arial, sans-serif; padding: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th, td { border: 1px solid #dce0e5; padding: 8px; text-align: right; }
        thead { background: #eef2f7; }
        .positive { background: #ecfdf3; color: #15803d; }
        .negative { background: #fef2f2; color: #b91c1c; }
        .total-row { font-weight: 700; background: #f8fafc; }
        .balance { margin-top: 12px; font-weight: 800; }
      </style>
    `;

    const htmlContent = `
      <html>
        <head>${style}</head>
        <body>
          ${tableHtml}
          <div class="balance">${balanceText}</div>
        </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `expenses-${this.getCurrentDateTime().replace(/\\s+/g, '_')}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ==================== Payment Receipt Methods ====================

  openPaymentReceiptModal() {
    this.paymentReceiptForm.reset({
      monthYear: new Date().toISOString(),
      amount: null,
      paidTo: this.currentParentRole === 'parent1' ? 'parent2' : 'parent1',
      description: ''
    });
    this.pendingPaymentReceiptFile = undefined;
    this.pendingPaymentReceiptPreview = undefined;
    this.paymentReceiptModalOpen = true;
  }

  closePaymentReceiptModal() {
    this.paymentReceiptModalOpen = false;
    this.pendingPaymentReceiptFile = undefined;
    this.pendingPaymentReceiptPreview = undefined;
  }

  async onPaymentReceiptSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.pendingPaymentReceiptFile = undefined;
      this.pendingPaymentReceiptPreview = undefined;
      return;
    }

    const file = input.files[0];
    this.pendingPaymentReceiptFile = file;

    const compressed = await this.paymentReceiptService.compressImage(file);
    if (compressed) {
      this.pendingPaymentReceiptPreview = compressed;
    } else {
      this.pendingPaymentReceiptFile = undefined;
      this.pendingPaymentReceiptPreview = undefined;
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.toast.receiptTooLargeFallback'),
        duration: 3000,
        color: 'warning'
      });
      toast.present();
    }

    input.value = '';
  }

  removePendingPaymentReceipt() {
    this.pendingPaymentReceiptFile = undefined;
    this.pendingPaymentReceiptPreview = undefined;
  }

  async uploadPaymentReceipt() {
    if (!this.pendingPaymentReceiptPreview || this.paymentReceiptForm.invalid) {
      return;
    }

    this.isUploadingReceipt = true;
    try {
      const { monthYear, amount, paidTo, description } = this.paymentReceiptForm.value;
      const date = new Date(monthYear);

      await this.paymentReceiptService.addReceipt({
        month: date.getMonth(),
        year: date.getFullYear(),
        imageUrl: this.pendingPaymentReceiptPreview,
        imageName: this.pendingPaymentReceiptFile?.name,
        amount: amount ? Number(amount) : undefined,
        paidTo,
        description: description?.trim() || undefined
      });

      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.receipts.toast.uploaded'),
        duration: 2000,
        color: 'success'
      });
      toast.present();

      this.closePaymentReceiptModal();
    } catch (error) {
      console.error('Failed to upload payment receipt', error);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.receipts.toast.uploadFailed'),
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    } finally {
      this.isUploadingReceipt = false;
    }
  }

  viewPaymentReceipt(receipt: PaymentReceipt) {
    this.viewingReceipt = receipt;
  }

  closeReceiptViewer() {
    this.viewingReceipt = null;
  }

  async deletePaymentReceipt(receipt: PaymentReceipt) {
    const confirmed = window.confirm(this.i18n.translate('expenses.receipts.confirm.delete'));
    if (!confirmed) {
      return;
    }

    try {
      await this.paymentReceiptService.deleteReceipt(receipt.id);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.receipts.toast.deleted'),
        duration: 2000,
        color: 'medium'
      });
      toast.present();
    } catch (error) {
      console.error('Failed to delete payment receipt', error);
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('expenses.receipts.toast.deleteFailed'),
        duration: 2500,
        color: 'danger'
      });
      toast.present();
    }
  }
}
