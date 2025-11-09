export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  type: EventType;
  parentId: 'parent1' | 'parent2' | 'both';
  color?: string;
  location?: string;
  reminderMinutes?: number;
  isAllDay?: boolean;
  recurring?: RecurringPattern;
}

export enum EventType {
  CUSTODY = 'custody',        // משמרת רגילה
  PICKUP = 'pickup',          // איסוף
  DROPOFF = 'dropoff',        // החזרה
  SCHOOL = 'school',          // בית ספר / גן
  ACTIVITY = 'activity',      // פעילות חוץ
  MEDICAL = 'medical',        // רפואי
  HOLIDAY = 'holiday',        // חג
  VACATION = 'vacation',      // חופשה
  OTHER = 'other'
}

export interface RecurringPattern {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  endDate?: Date;
  daysOfWeek?: number[]; // 0-6 (Sunday-Saturday)
}

export interface CalendarDay {
  date: Date;
  isToday: boolean;
  isCurrentMonth: boolean;
  events: CalendarEvent[];
  primaryParent?: 'parent1' | 'parent2';
}
