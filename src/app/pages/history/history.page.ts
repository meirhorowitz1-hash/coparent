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
  sectionFilter: 'all' | 'expenses' | 'tasks' | 'calendar' = 'all';

  expenses: ExpenseRecord[] = [];
  tasks: Task[] = [];
  swapRequests: SwapRequest[] = [];
  calendarEvents: CalendarEvent[] = [];
  financeSettings: FinanceSettings | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private expenseStore: ExpenseStoreService,
    private taskHistoryService: TaskHistoryService,
    private swapRequestService: SwapRequestService,
    private route: ActivatedRoute,
    private calendarService: CalendarService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const section = params.get('section');
      if (section === 'expenses' || section === 'tasks' || section === 'calendar') {
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
      this.calendarService.events$
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([expenses, tasks, swapRequests, financeSettings, events]) => {
        this.financeSettings = financeSettings;
        const approvedExpenses = expenses.filter(expense => expense.status === 'approved');
        this.expenses = this.mergeFixedExpenses(approvedExpenses, financeSettings);
        this.tasks = tasks;
        this.swapRequests = swapRequests;
        this.calendarEvents = events.filter(event => !event.swapRequestId);
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
    return matched?.label ?? 'כל החודשים';
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

  formatDate(value: Date | string | number | null | undefined): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('he-IL', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });
  }

  formatTime(date: Date | string | number | null | undefined): string {
    if (!date) {
      return '';
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return '';
    }
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  getRequestStatusLabel(status: SwapRequestStatus): string {
    const labels: Record<SwapRequestStatus, string> = {
      [SwapRequestStatus.PENDING]: 'ממתינה',
      [SwapRequestStatus.APPROVED]: 'אושרה',
      [SwapRequestStatus.REJECTED]: 'נדחתה',
      [SwapRequestStatus.CANCELLED]: 'בוטלה'
    };
    return labels[status];
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
    return request.requestType === 'one-way' ? 'בקשה ללא החזרה' : 'בקשת החלפה';
  }

  getTaskStatusLabel(status: TaskStatus): string {
    const labels: Record<TaskStatus, string> = {
      [TaskStatus.PENDING]: 'ממתינה',
      [TaskStatus.IN_PROGRESS]: 'בתהליך',
      [TaskStatus.COMPLETED]: 'הושלמה',
      [TaskStatus.CANCELLED]: 'בוטלה'
    };
    return labels[status];
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
    const labels: Record<CalendarEvent['type'], string> = {
      custody: 'משמרת',
      pickup: 'איסוף',
      dropoff: 'החזרה',
      school: 'בית ספר',
      activity: 'פעילות',
      medical: 'רפואי',
      holiday: 'חג',
      vacation: 'חופשה',
      other: 'אחר'
    };
    return labels[type] || 'אירוע';
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

    const options: MonthOption[] = Array.from(monthMap.entries())
      .map(([value, date]) => ({
        value,
        label: this.buildMonthLabel(date),
        date: new Date(date.getFullYear(), date.getMonth(), 1)
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    this.monthOptions = [{ value: 'all', label: 'כל החודשים', date: new Date() }, ...options];

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
    return date.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
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
          createdByName: 'הוצאה קבועה',
          notes: 'הוצאה קבועה',
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
}
