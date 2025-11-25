import { Injectable, OnDestroy } from '@angular/core';
import { Observable, BehaviorSubject, Subscription } from 'rxjs';
import { DailyOverview, CustodyToday, DailySummary, QuickAction } from '../models/daily-overview.model';
import { CalendarEvent } from '../models/calendar-event.model';
import { Task, TaskStatus, TaskPriority } from '../models/task.model';
import { Expense, ExpenseCategory, ExpenseStatus, SplitType } from '../models/expense.model';
import { CalendarService } from './calendar.service';
import { SwapRequest, SwapRequestStatus } from '../models/swap-request.model';
import { SwapRequestService } from './swap-request.service';
import { ExpenseStoreService, ExpenseRecord } from './expense-store.service';

@Injectable({
  providedIn: 'root'
})
export class HomeService implements OnDestroy {
  private dailyOverviewSubject = new BehaviorSubject<DailyOverview | null>(null);
  public dailyOverview$ = this.dailyOverviewSubject.asObservable();
  private subscriptions = new Subscription();
  private currentDate: Date = new Date();
  private swapRequests: SwapRequest[] = [];

  constructor(
    private calendarService: CalendarService,
    private swapRequestService: SwapRequestService,
    private expenseStore: ExpenseStoreService
  ) {
    this.subscriptions.add(
      this.calendarService.events$.subscribe(() => {
        this.loadDailyOverview(this.currentDate);
      })
    );

    this.subscriptions.add(
      this.calendarService.custodySchedule$.subscribe(() => {
        this.loadDailyOverview(this.currentDate);
      })
    );

    this.subscriptions.add(
      this.swapRequestService.swapRequests$.subscribe(requests => {
        this.swapRequests = requests;
        const currentOverview = this.dailyOverviewSubject.value;
        if (currentOverview) {
          this.dailyOverviewSubject.next({
            ...currentOverview,
            swapRequests: [...requests]
          });
        }
      })
    );

    this.subscriptions.add(
      this.expenseStore.expenses$.subscribe(() => {
        this.loadDailyOverview(this.currentDate);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /**
   * טוען את המצב היומי הנוכחי
   */
  loadDailyOverview(date: Date = new Date()): void {
    this.currentDate = date;
    // כאן תהיה קריאה ל-Firebase או שירות אחר
    // לעת עתה נחזיר דמה
    const overview: DailyOverview = {
      date,
      custodyToday: this.getCustodyForDate(date),
      events: this.getEventsForDate(date),
      upcomingTasks: this.getUpcomingTasks(),
      pendingExpenses: this.getPendingExpenses(),
      swapRequests: [...this.swapRequests],
      summary: {
        eventsCount: 0,
        tasksCount: 0,
        pendingExpensesCount: 0,
        hasUrgentTasks: false,
        totalPendingAmount: 0
      }
    };

    // חישוב הסיכום
    overview.summary = this.calculateSummary(overview);

    this.dailyOverviewSubject.next(overview);
  }

  /**
   * מחזיר את מצב המשמורת להיום
   */
  private getCustodyForDate(date: Date): CustodyToday {
    const custodyDetails = this.calendarService.getCustodyDetailsForDate(date);

    if (custodyDetails) {
      return custodyDetails;
    }

    return {
      currentParent: null
    };
  }

  /**
   * מחזיר אירועים להיום
   */
  private getEventsForDate(date: Date): CalendarEvent[] {
    return this.calendarService.getEventsForDay(date);
  }

  /**
   * מחזיר משימות קרובות (הבא עד 7 ימים)
   */
  private getUpcomingTasks(): Task[] {
    // כאן תהיה קריאה ל-Firebase
    return [];
  }

  /**
   * מחזיר הוצאות ממתינות לאישור
   */
  private getPendingExpenses(): Expense[] {
    return this.expenseStore
      .getAll()
      .filter(expense => expense.status === 'pending')
      .map(expense => this.mapExpenseRecord(expense));
  }

  private mapExpenseRecord(expense: ExpenseRecord): Expense {
    const statusMap: Record<ExpenseRecord['status'], ExpenseStatus> = {
      pending: ExpenseStatus.PENDING,
      approved: ExpenseStatus.APPROVED,
      rejected: ExpenseStatus.REJECTED
    };

    return {
      id: expense.id,
      title: expense.title,
      description: expense.notes,
      amount: expense.amount,
      currency: 'ILS',
      date: expense.date,
      category: ExpenseCategory.OTHER,
      paidBy: expense.createdBy || '',
      splitType: SplitType.EQUAL,
      splitDetails: [],
      status: statusMap[expense.status],
      receipt: expense.receiptName,
      approvedBy: expense.status === 'approved' ? [expense.createdByName || expense.createdBy || 'local'] : [],
      createdAt: expense.createdAt,
      updatedAt: expense.createdAt
    };
  }

  /**
   * מחשב סיכום יומי
   */
  private calculateSummary(overview: DailyOverview): DailySummary {
    const hasUrgentTasks = overview.upcomingTasks.some(
      task => task.priority === TaskPriority.URGENT && task.status !== TaskStatus.COMPLETED
    );

    const totalPendingAmount = overview.pendingExpenses.reduce(
      (sum, expense) => sum + expense.amount, 
      0
    );

    return {
      eventsCount: overview.events.length,
      tasksCount: overview.upcomingTasks.filter(t => t.status !== TaskStatus.COMPLETED).length,
      pendingExpensesCount: overview.pendingExpenses.length,
      hasUrgentTasks,
      totalPendingAmount
    };
  }

  /**
   * מחזיר פעולות מהירות
   */
  getQuickActions(): QuickAction[] {
    const overview = this.dailyOverviewSubject.value;
    
    return [
      {
        id: 'swap-request',
        title: 'בקשת החלפה',
        icon: 'swap-horizontal',
        route: '/calendar',
        color: 'primary'
      },
      {
        id: 'new-expense',
        title: 'הוצאה חדשה',
        icon: 'wallet',
        route: '/expenses',
        badge: overview?.pendingExpenses.length,
        color: 'success'
      },
      {
        id: 'new-task',
        title: 'משימה חדשה',
        icon: 'checkbox',
        route: '/tasks',
        badge: overview?.upcomingTasks.filter(t => t.status !== TaskStatus.COMPLETED).length,
        color: 'warning'
      },
      {
        id: 'add-event',
        title: 'אירוע חדש',
        icon: 'calendar',
        route: '/calendar',
        color: 'tertiary'
      }
    ];
  }

  /**
   * רענון הנתונים
   */
  refresh(): Observable<DailyOverview | null> {
    this.loadDailyOverview();
    return this.dailyOverview$;
  }

  /**
   * עדכון סטטוס של בקשת החלפה קיימת
   */
  updateSwapRequestStatus(
    id: string,
    status: SwapRequestStatus,
    responseNote?: string
  ): Promise<void> {
    return this.swapRequestService.updateSwapRequestStatus(id, status, responseNote);
  }

  submitSwapRequest(payload: {
    originalDate: Date;
    proposedDate: Date;
    reason?: string;
  }): Promise<void> {
    return this.swapRequestService.createSwapRequest(payload);
  }

  getCurrentUserId(): string | null {
    return this.swapRequestService.getCurrentUserId();
  }
}
