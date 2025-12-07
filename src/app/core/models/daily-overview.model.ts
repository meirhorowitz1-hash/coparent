import { CalendarEvent } from './calendar-event.model';
import { Task } from './task.model';
import { Expense } from './expense.model';
import { SwapRequest } from './swap-request.model';

export interface DailyOverview {
  date: Date;
  custodyToday: CustodyToday;
  events: CalendarEvent[];
  upcomingTasks: Task[];
  pendingExpenses: Expense[];
  swapRequests: SwapRequest[];
  summary: DailySummary;
}

export interface CustodyToday {
  currentParent: 'parent1' | 'parent2' | 'both' | null;
  currentParentName?: string;
  nextTransition?: {
    date: Date;
    toParent: 'parent1' | 'parent2';
    toParentName?: string;
    type: 'pickup' | 'dropoff';
  };
}

export interface DailySummary {
  eventsCount: number;
  tasksCount: number;
  pendingExpensesCount: number;
  hasUrgentTasks: boolean;
  totalPendingAmount: number;
  totalExpensesAmount: number;
  approvedExpensesAmount: number;
}

export interface QuickAction {
  id: string;
  title: string;
  icon: string;
  route?: string;
  action?: () => void;
  badge?: number;
  emptyLabel?: string;
  color?: string;
  disabled?: boolean;
}
