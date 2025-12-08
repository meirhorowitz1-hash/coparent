import { Component, OnDestroy, OnInit } from '@angular/core';
import { combineLatest, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ActivatedRoute } from '@angular/router';

import { ExpenseRecord, ExpenseStoreService, FinanceSettings } from '../../core/services/expense-store.service';
import { Task, TaskPriority, TaskStatus } from '../../core/models/task.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';
import { SwapRequestService } from '../../core/services/swap-request.service';
import { CalendarEvent } from '../../core/models/calendar-event.model';
import { CalendarService } from '../../core/services/calendar.service';
import { I18nService } from '../../core/services/i18n.service';
import { PaymentReceiptService } from '../../core/services/payment-receipt.service';
import { PaymentReceipt, MonthlyPaymentSummary } from '../../core/models/payment-receipt.model';

interface MonthOption {
  value: string;
  label: string;
  date: Date;
}

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: false
})
export class HistoryPage implements OnInit, OnDestroy {
  monthOptions: MonthOption[] = [];
  selectedMonth = 'all';
  isLoading = true;
  sectionFilter: 'all' | 'expenses' | 'tasks' | 'calendar' | 'payments' = 'all';

  expenses: ExpenseRecord[] = [];
  tasks: Task[] = [];
  swapRequests: SwapRequest[] = [];
  calendarEvents: CalendarEvent[] = [];
  paymentReceipts: PaymentReceipt[] = [];
  financeSettings: FinanceSettings | null = null;
  viewingReceipt: PaymentReceipt | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private expenseStore: ExpenseStoreService,
    private taskHistoryService: TaskHistoryService,
    private swapRequestService: SwapRequestService,
    private paymentReceiptService: PaymentReceiptService,
    private route: ActivatedRoute,
    private calendarService: CalendarService,
    private i18n: I18nService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const section = params.get('section');
      if (section === 'expenses' || section === 'tasks' || section === 'calendar' || section === 'payments') {
        this.sectionFilter = section;
      } else {
        this.sectionFilter = 'all';
      }
    });

    combineLatest([
      this.expenseStore.expenses$,
      this.taskHistoryService.tasks$,
      this.swapRequestService.swapRequests$,
      this.expenseStore.financeSettings$,
      this.calendarService.events$,
      this.paymentReceiptService.receipts$
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([expenses, tasks, swapRequests, financeSettings, events, paymentReceipts]) => {
        this.financeSettings = financeSettings;
        const approvedExpenses = expenses.filter(expense => expense.status === 'approved');
        this.expenses = this.mergeFixedExpenses(approvedExpenses, financeSettings);
        this.tasks = tasks;
        this.swapRequests = swapRequests;
        this.calendarEvents = events.filter(event => !event.swapRequestId);
        this.paymentReceipts = paymentReceipts;
        console.log('[HistoryPage] Payment receipts loaded:', paymentReceipts.length, paymentReceipts);
        console.log('[HistoryPage] showPayments():', this.showPayments());
        this.rebuildMonthOptions();
        this.isLoading = false;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get selectedMonthLabel(): string {
    const matched = this.monthOptions.find(option => option.value === this.selectedMonth);
    if (matched) {
      return matched.label;
    }
    return this.i18n.translate('history.filter.monthAll');
  }

  get filteredExpenses(): ExpenseRecord[] {
    return this.applyMonthFilter(this.expenses, expense => expense.date);
  }

  get filteredTasks(): Task[] {
    return this.applyMonthFilter(this.tasks, task => task.dueDate);
  }

  get filteredSwapRequests(): SwapRequest[] {
    return this.applyMonthFilter(this.swapRequests, request => request.createdAt ?? request.originalDate);
  }

  get filteredEvents(): CalendarEvent[] {
    return this.applyMonthFilter(this.calendarEvents, event => event.startDate);
  }

  get filteredPaymentReceipts(): PaymentReceipt[] {
    return this.applyMonthFilter(this.paymentReceipts, receipt => receipt.createdAt);
  }

  get paymentReceiptsByMonth(): MonthlyPaymentSummary[] {
    const receipts = this.filteredPaymentReceipts;
    const buckets = new Map<string, MonthlyPaymentSummary>();

    receipts.forEach(receipt => {
      const key = `${receipt.year}-${receipt.month}`;
      if (!buckets.has(key)) {
        const baseDate = new Date(receipt.year, receipt.month, 1);
        const label = baseDate.toLocaleDateString(this.i18n.locale, {
          month: 'long',
          year: 'numeric'
        });
        buckets.set(key, {
          month: receipt.month,
          year: receipt.year,
          label,
          receipts: [],
          totalPaid: 0
        });
      }
      const bucket = buckets.get(key)!;
      bucket.receipts.push(receipt);
      bucket.totalPaid += receipt.amount ?? 0;
    });

    return Array.from(buckets.values()).sort((a, b) => {
      if (a.year === b.year) return b.month - a.month;
      return b.year - a.year;
    });
  }

  getExpenseStatusLabel(status: string): string {
    const key =
      status === 'approved'
        ? 'history.status.approved'
        : status === 'pending'
          ? 'history.status.pending'
          : status === 'rejected'
            ? 'history.status.rejected'
            : 'history.status.cancelled';
    return this.i18n.translate(key);
  }

  getExpenseCreatorName(expense: ExpenseRecord): string {
    return expense.createdByName || expense.createdBy || this.i18n.translate('expenses.unknownPayer');
  }

  get hasData(): boolean {
    return (
      this.filteredExpenses.length > 0 ||
      this.filteredTasks.length > 0 ||
      this.filteredSwapRequests.length > 0 ||
      this.filteredEvents.length > 0
    );
  }

  onMonthChange(value: string | null | undefined): void {
    if (!value) {
      return;
    }
    this.selectedMonth = value;
  }

  clearMonthFilter(): void {
    this.selectedMonth = 'all';
  }

  openReceipt(preview?: string | null): void {
    if (!preview) {
      return;
    }
    const url = this.dataUrlToObjectUrl(preview) || preview;
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open receipt preview', error);
    }
  }

  formatDate(value: Date | string | number | null | undefined): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString(this.i18n.locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString(this.i18n.locale, { style: 'currency', currency: 'ILS' });
  }

  formatTime(date: Date | string | number | null | undefined): string {
    if (!date) {
      return '';
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return '';
    }
    return d.toLocaleTimeString(this.i18n.locale, { hour: '2-digit', minute: '2-digit' });
  }

  getRequestStatusLabel(status: SwapRequestStatus): string {
    return this.i18n.translate(`history.status.${status}`);
  }

  getRequestStatusColor(status: SwapRequestStatus): string {
    const colors: Record<SwapRequestStatus, string> = {
      [SwapRequestStatus.PENDING]: 'warning',
      [SwapRequestStatus.APPROVED]: 'success',
      [SwapRequestStatus.REJECTED]: 'danger',
      [SwapRequestStatus.CANCELLED]: 'medium'
    };
    return colors[status] || 'medium';
  }

  getRequestTypeLabel(request: SwapRequest): string {
    return this.i18n.translate(
      request.requestType === 'one-way'
        ? 'home.request.type.oneWay'
        : 'home.request.type.swap'
    );
  }

  getTaskStatusLabel(status: TaskStatus): string {
    const map: Record<TaskStatus, string> = {
      [TaskStatus.PENDING]: this.i18n.translate('tasks.status.pending'),
      [TaskStatus.IN_PROGRESS]: this.i18n.translate('tasks.status.inProgress'),
      [TaskStatus.COMPLETED]: this.i18n.translate('tasks.status.completed'),
      [TaskStatus.CANCELLED]: this.i18n.translate('tasks.status.cancelled')
    };
    return map[status];
  }

  getTaskPriorityColor(priority: TaskPriority): string {
    const colors: Record<TaskPriority, string> = {
      [TaskPriority.URGENT]: 'danger',
      [TaskPriority.HIGH]: 'warning',
      [TaskPriority.MEDIUM]: 'primary',
      [TaskPriority.LOW]: 'medium'
    };
    return colors[priority] || 'medium';
  }

  getEventTypeLabel(type: CalendarEvent['type']): string {
    const key = `calendar.eventType.${type}`;
    return this.i18n.translate(key) || this.i18n.translate('calendar.eventType.other');
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

  private rebuildMonthOptions(): void {
    const monthMap = new Map<string, Date>();

    const addDate = (value: Date | string | number | null | undefined) => {
      if (!value) {
        return;
      }
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return;
      }
      const key = this.buildMonthKey(date);
      if (!monthMap.has(key)) {
        monthMap.set(key, date);
      }
    };

    this.expenses.forEach(expense => addDate(expense.date));
    this.tasks.forEach(task => addDate(task.dueDate));
    this.swapRequests.forEach(request => addDate(request.createdAt ?? request.originalDate));
    this.calendarEvents.forEach(event => addDate(event.startDate));
    this.paymentReceipts.forEach(receipt => addDate(receipt.createdAt));

    const options: MonthOption[] = Array.from(monthMap.entries())
      .map(([value, date]) => ({
        value,
        label: this.buildMonthLabel(date),
        date: new Date(date.getFullYear(), date.getMonth(), 1)
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    this.monthOptions = [
      { value: 'all', label: this.i18n.translate('history.filter.monthAll'), date: new Date() },
      ...options
    ];

    if (!this.monthOptions.some(option => option.value === this.selectedMonth)) {
      this.selectedMonth = 'all';
    }
  }

  private applyMonthFilter<T>(
    items: T[],
    dateSelector: (item: T) => Date | string | number | null | undefined
  ): T[] {
    if (this.selectedMonth === 'all') {
      return items;
    }

    return items.filter(item => {
      const date = dateSelector(item);
      if (!date) {
        return false;
      }
      const normalized = new Date(date);
      if (isNaN(normalized.getTime())) {
        return false;
      }
      return this.buildMonthKey(normalized) === this.selectedMonth;
    });
  }

  private buildMonthKey(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  private buildMonthLabel(date: Date): string {
    return date.toLocaleDateString(this.i18n.locale, { month: 'long', year: 'numeric' });
  }

  private mergeFixedExpenses(expenses: ExpenseRecord[], settings: FinanceSettings): ExpenseRecord[] {
    if (!settings?.fixedExpenses?.length) {
      return expenses;
    }

    const monthKeys = new Set<string>();
    const dateByKey = new Map<string, Date>();

    expenses.forEach(expense => {
      const date = new Date(expense.date);
      const key = this.buildMonthKey(date);
      monthKeys.add(key);
      dateByKey.set(key, new Date(date.getFullYear(), date.getMonth(), 1));
    });

    if (!monthKeys.size) {
      const now = new Date();
      const key = this.buildMonthKey(now);
      monthKeys.add(key);
      dateByKey.set(key, new Date(now.getFullYear(), now.getMonth(), 1));
    }

    const fixedRecords: ExpenseRecord[] = [];
    monthKeys.forEach(key => {
      const date = dateByKey.get(key) ?? new Date();
      const month = date.getMonth();
      const year = date.getFullYear();
      settings.fixedExpenses.forEach(fixed => {
        fixedRecords.push({
          id: `fixed-${fixed.id}-${year}-${month}`,
          title: fixed.title,
          amount: fixed.amount,
          date: new Date(year, month, 1),
          createdBy: 'system',
          createdByName: this.i18n.translate('expenses.fixedExpenseLabel'),
          notes: this.i18n.translate('expenses.fixedExpenseLabel'),
          receiptName: undefined,
          receiptPreview: undefined,
          splitParent1:
            typeof fixed.splitParent1 === 'number'
              ? Math.min(100, Math.max(0, fixed.splitParent1))
              : 50,
          status: 'approved',
          isPaid: false,
          createdAt: new Date(year, month, 1)
        });
      });
    });

    return [...expenses, ...fixedRecords];
  }

  showExpenses(): boolean {
    return this.sectionFilter === 'all' || this.sectionFilter === 'expenses';
  }

  showTasks(): boolean {
    return this.sectionFilter === 'all' || this.sectionFilter === 'tasks';
  }

  showCalendar(): boolean {
    return this.sectionFilter === 'all' || this.sectionFilter === 'calendar';
  }

  showPayments(): boolean {
    return this.sectionFilter === 'all' || this.sectionFilter === 'payments' || this.sectionFilter === 'expenses';
  }

  viewPaymentReceipt(receipt: PaymentReceipt): void {
    this.viewingReceipt = receipt;
  }

  closeReceiptViewer(): void {
    this.viewingReceipt = null;
  }

  getParentLabel(role: 'parent1' | 'parent2'): string {
    return this.i18n.translate(role === 'parent1' ? 'profile.parent1' : 'profile.parent2');
  }
}
