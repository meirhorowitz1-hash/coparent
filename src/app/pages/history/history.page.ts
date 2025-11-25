import { Component, OnDestroy, OnInit } from '@angular/core';
import { combineLatest, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { ExpenseRecord, ExpenseStoreService } from '../../core/services/expense-store.service';
import { Task, TaskPriority, TaskStatus } from '../../core/models/task.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';
import { SwapRequestService } from '../../core/services/swap-request.service';

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

  expenses: ExpenseRecord[] = [];
  tasks: Task[] = [];
  swapRequests: SwapRequest[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private expenseStore: ExpenseStoreService,
    private taskHistoryService: TaskHistoryService,
    private swapRequestService: SwapRequestService
  ) {}

  ngOnInit(): void {
    combineLatest([
      this.expenseStore.expenses$,
      this.taskHistoryService.tasks$,
      this.swapRequestService.swapRequests$
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([expenses, tasks, swapRequests]) => {
        this.expenses = expenses;
        this.tasks = tasks;
        this.swapRequests = swapRequests;
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

  get hasData(): boolean {
    return (
      this.filteredExpenses.length > 0 ||
      this.filteredTasks.length > 0 ||
      this.filteredSwapRequests.length > 0
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
}
