import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CalendarEvent, CalendarDay, EventType } from '../models/calendar-event.model';
import { CustodySchedule, CustodyPattern } from '../models/custody-schedule.model';

@Injectable({
  providedIn: 'root'
})
export class CalendarService {
  private eventsSubject = new BehaviorSubject<CalendarEvent[]>([]);
  public events$ = this.eventsSubject.asObservable();

  private currentMonthSubject = new BehaviorSubject<Date>(new Date());
  public currentMonth$ = this.currentMonthSubject.asObservable();

  private custodyScheduleSubject = new BehaviorSubject<CustodySchedule | null>(null);
  public custodySchedule$ = this.custodyScheduleSubject.asObservable();

  constructor() {
    const stored = this.loadFromStorage();
    if (stored.length > 0) {
      this.eventsSubject.next(stored);
    } else {
      this.loadMockData();
    }
    
    // טען משמרת קבועה אם קיימת
    const existingSchedule = this.loadCustodySchedule();
    if (existingSchedule && existingSchedule.isActive) {
      // ודא שאין כבר משמרות בלוח
      const hasCustodyEvents = this.eventsSubject.value.some(e => e.type === EventType.CUSTODY);
      if (!hasCustodyEvents) {
        this.generateCustodyEvents(existingSchedule);
      }
    }
  }

  // יצירת מבנה לוח שנה לחודש
  generateCalendarDays(year: number, month: number): CalendarDay[] {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // התחל מיום ראשון

    const days: CalendarDay[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // צור 42 ימים (6 שבועות)
    for (let i = 0; i < 42; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      
      const dayEvents = this.getEventsForDate(currentDate);
      const primaryParent = this.getPrimaryParentForDate(currentDate, dayEvents);

      days.push({
        date: currentDate,
        isToday: currentDate.getTime() === today.getTime(),
        isCurrentMonth: currentDate.getMonth() === month,
        events: dayEvents,
        primaryParent
      });
    }

    return days;
  }

  // קבל אירועים לתאריך מסוים
  private getEventsForDate(date: Date): CalendarEvent[] {
    const events = this.eventsSubject.value;
    return events.filter(event => {
      const eventDate = new Date(event.startDate);
      eventDate.setHours(0, 0, 0, 0);
      const checkDate = new Date(date);
      checkDate.setHours(0, 0, 0, 0);
      
      // בדוק אם האירוע מתרחש בתאריך זה
      if (event.isAllDay) {
        return eventDate.getTime() === checkDate.getTime();
      }
      
      // בדוק אם התאריך בין תאריך התחלה וסיום
      const endDate = new Date(event.endDate);
      endDate.setHours(0, 0, 0, 0);
      return checkDate >= eventDate && checkDate <= endDate;
    });
  }

  // זהה מי ההורה הראשי ביום הזה (למשמרות)
  private getPrimaryParentForDate(date: Date, events: CalendarEvent[]): 'parent1' | 'parent2' | undefined {
    const custodyEvent = events.find(e => e.type === EventType.CUSTODY);
    return custodyEvent?.parentId !== 'both' ? custodyEvent?.parentId : undefined;
  }

  // הוסף אירוע חדש
  addEvent(event: Omit<CalendarEvent, 'id'>): void {
    const newEvent: CalendarEvent = {
      ...event,
      id: this.generateId()
    };
    
    const events = [...this.eventsSubject.value, newEvent];
    this.eventsSubject.next(events);
    this.saveToStorage(events);
  }

  // עדכן אירוע
  updateEvent(id: string, updates: Partial<CalendarEvent>): void {
    const events = this.eventsSubject.value.map(event =>
      event.id === id ? { ...event, ...updates } : event
    );
    this.eventsSubject.next(events);
    this.saveToStorage(events);
  }

  // מחק אירוע
  deleteEvent(id: string): void {
    const events = this.eventsSubject.value.filter(event => event.id !== id);
    this.eventsSubject.next(events);
    this.saveToStorage(events);
  }

  // שנה חודש
  setCurrentMonth(date: Date): void {
    this.currentMonthSubject.next(date);
  }

  nextMonth(): void {
    const current = this.currentMonthSubject.value;
    const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    console.log('Service: Moving to next month', current, '->', next);
    this.currentMonthSubject.next(next);
  }

  previousMonth(): void {
    const current = this.currentMonthSubject.value;
    const prev = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    console.log('Service: Moving to previous month', current, '->', prev);
    this.currentMonthSubject.next(prev);
  }

  // שמור ב-localStorage
  private saveToStorage(events: CalendarEvent[]): void {
    localStorage.setItem('coparent_calendar_events', JSON.stringify(events));
  }

  // טען מ-localStorage
  private loadFromStorage(): CalendarEvent[] {
    const stored = localStorage.getItem('coparent_calendar_events');
    if (stored) {
      const events = JSON.parse(stored);
      // המר מחרוזות לתאריכים
      return events.map((e: any) => ({
        ...e,
        startDate: new Date(e.startDate),
        endDate: new Date(e.endDate)
      }));
    }
    return [];
  }

  // יצירת ID ייחודי
  private generateId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // טען דוגמאות למבחן
  private loadMockData(): void {
    // דוגמאות לאירועים - רק אם אין נתונים
    const today = new Date();
    const mockEvents: CalendarEvent[] = [
      {
        id: '3',
        title: 'בית ספר - יום הורים',
        description: 'פגישת הורים עם המחנכת',
        startDate: new Date(today.getFullYear(), today.getMonth(), 15, 17, 0),
        endDate: new Date(today.getFullYear(), today.getMonth(), 15, 18, 0),
        type: EventType.SCHOOL,
        parentId: 'both',
        color: '#FF9800',
        location: 'בית ספר אלון'
      }
    ];

    this.eventsSubject.next(mockEvents);
    this.saveToStorage(mockEvents);
  }

  // ========== פונקציות משמרות קבועות ==========

  // שמור משמרת קבועה
  saveCustodySchedule(schedule: CustodySchedule): void {
    this.custodyScheduleSubject.next(schedule);
    localStorage.setItem('coparent_custody_schedule', JSON.stringify(schedule));
    
    // מחק משמרות ישנות
    this.deleteOldCustodyEvents();
    
    // צור אירועים חדשים
    this.generateCustodyEvents(schedule);
  }

  // טען משמרת קבועה
  loadCustodySchedule(): CustodySchedule | null {
    const stored = localStorage.getItem('coparent_custody_schedule');
    if (stored) {
      const schedule = JSON.parse(stored);
      schedule.startDate = new Date(schedule.startDate);
      if (schedule.endDate) {
        schedule.endDate = new Date(schedule.endDate);
      }
      this.custodyScheduleSubject.next(schedule);
      return schedule;
    }
    return null;
  }

  // מחק משמרת קבועה
  deleteCustodySchedule(): void {
    this.custodyScheduleSubject.next(null);
    localStorage.removeItem('coparent_custody_schedule');
    this.deleteOldCustodyEvents();
  }

  // מחק כל אירועי המשמרות הישנים
  private deleteOldCustodyEvents(): void {
    const events = this.eventsSubject.value.filter(
      event => event.type !== EventType.CUSTODY
    );
    this.eventsSubject.next(events);
    this.saveToStorage(events);
  }

  // צור אירועי משמרות על פי התבנית
  private generateCustodyEvents(schedule: CustodySchedule): void {
    const events = [...this.eventsSubject.value];
    const startDate = new Date(schedule.startDate);
    const endDate = schedule.endDate ? new Date(schedule.endDate) : this.getDefaultEndDate();
    
    let currentDate = new Date(startDate);
    let weekCounter = 0;

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      
      let parentId: 'parent1' | 'parent2' | null = null;
      
      switch (schedule.pattern) {
        case CustodyPattern.WEEKLY:
          // כל שבוע אותו דבר
          if (schedule.parent1Days.includes(dayOfWeek)) {
            parentId = 'parent1';
          } else if (schedule.parent2Days.includes(dayOfWeek)) {
            parentId = 'parent2';
          }
          break;
          
        case CustodyPattern.BIWEEKLY:
          // לסירוגין כל שבועיים
          const isEvenWeek = weekCounter % 2 === 0;
          if (isEvenWeek) {
            if (schedule.parent1Days.includes(dayOfWeek)) {
              parentId = 'parent1';
            } else if (schedule.parent2Days.includes(dayOfWeek)) {
              parentId = 'parent2';
            }
          } else {
            if (schedule.parent2Days.includes(dayOfWeek)) {
              parentId = 'parent1';
            } else if (schedule.parent1Days.includes(dayOfWeek)) {
              parentId = 'parent2';
            }
          }
          break;
          
        case CustodyPattern.WEEK_ON_WEEK_OFF:
          // שבוע שלם אצל כל הורה
          parentId = weekCounter % 2 === 0 ? 'parent1' : 'parent2';
          break;
      }

      if (parentId) {
        events.push({
          id: this.generateId(),
          title: `משמרת - ${parentId === 'parent1' ? 'הורה 1' : 'הורה 2'}`,
          startDate: new Date(currentDate),
          endDate: new Date(currentDate),
          type: EventType.CUSTODY,
          parentId: parentId,
          color: parentId === 'parent1' ? '#4CAF50' : '#2196F3',
          isAllDay: true
        });
      }

      // עבור ליום הבא
      currentDate.setDate(currentDate.getDate() + 1);
      
      // עדכן מונה שבועות
      if (currentDate.getDay() === 0) {
        weekCounter++;
      }
    }

    this.eventsSubject.next(events);
    this.saveToStorage(events);
  }

  // תאריך סיום ברירת מחדל (שנה מהיום)
  private getDefaultEndDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date;
  }
}
