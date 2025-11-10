import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docSnapshots,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable, Subscription, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { CalendarEvent, CalendarDay, EventType, RecurringPattern } from '../models/calendar-event.model';
import { CustodyToday } from '../models/daily-overview.model';
import { CustodySchedule, CustodyPattern } from '../models/custody-schedule.model';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { SwapRequest } from '../models/swap-request.model';

type FirestoreRecurringPattern = Omit<RecurringPattern, 'endDate'> & {
  endDate?: Timestamp | null;
};

type FirestoreCalendarEvent = Omit<CalendarEvent, 'startDate' | 'endDate' | 'recurring'> & {
  startDate: Timestamp;
  endDate: Timestamp;
  recurring?: FirestoreRecurringPattern;
};

type FirestoreCustodySchedule = Omit<CustodySchedule, 'startDate' | 'endDate'> & {
  startDate: Timestamp;
  endDate?: Timestamp | null;
};

@Injectable({
  providedIn: 'root'
})
export class CalendarService implements OnDestroy {
  private static readonly DAY_IN_MS = 24 * 60 * 60 * 1000;
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);

  private eventsSubject = new BehaviorSubject<CalendarEvent[]>([]);
  readonly events$: Observable<CalendarEvent[]> = this.eventsSubject.asObservable();

  private currentMonthSubject = new BehaviorSubject<Date>(new Date());
  readonly currentMonth$: Observable<Date> = this.currentMonthSubject.asObservable();

  private custodyScheduleSubject = new BehaviorSubject<CustodySchedule | null>(null);
  readonly custodySchedule$: Observable<CustodySchedule | null> = this.custodyScheduleSubject.asObservable();

  private activeFamilyIdSubject = new BehaviorSubject<string | null>(null);
  readonly activeFamilyId$: Observable<string | null> = this.activeFamilyIdSubject.asObservable();

  private profileSubscription?: Subscription;
  private eventsSubscription?: Subscription;
  private custodySubscription?: Subscription;

  constructor() {
    this.profileSubscription = this.authService.user$
      .pipe(
        switchMap(user => (user ? this.userProfileService.listenToProfile(user.uid) : of(null))),
        distinctUntilChanged((prev, curr) => prev?.activeFamilyId === curr?.activeFamilyId)
      )
      .subscribe(profile => {
        const familyId = profile?.activeFamilyId ?? null;
        this.activeFamilyIdSubject.next(familyId);
        this.subscribeToFamilyData(familyId);
      });
  }

  ngOnDestroy() {
    this.profileSubscription?.unsubscribe();
    this.detachFamilyListeners();
  }

  // ========= Firestore Sync =========

  private subscribeToFamilyData(familyId: string | null) {
    this.detachFamilyListeners();

    if (!familyId) {
      this.eventsSubject.next([]);
      this.custodyScheduleSubject.next(null);
      return;
    }

    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const eventsQuery = query(eventsRef, orderBy('startDate'));
    this.eventsSubscription = collectionData(eventsQuery, { idField: 'id' })
      .pipe(map(data => data.map(item => this.mapEventFromFirestore(item as FirestoreCalendarEvent))))
      .subscribe(events => this.eventsSubject.next(events));

    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');
    this.custodySubscription = docSnapshots(scheduleRef)
      .pipe(
        map(snapshot => {
          if (!snapshot.exists()) {
            return null;
          }

          const data = snapshot.data() as FirestoreCustodySchedule;
          return this.mapScheduleFromFirestore({ ...data, id: snapshot.id });
        })
      )
      .subscribe(schedule => this.custodyScheduleSubject.next(schedule));
  }

  private detachFamilyListeners() {
    this.eventsSubscription?.unsubscribe();
    this.eventsSubscription = undefined;
    this.custodySubscription?.unsubscribe();
    this.custodySubscription = undefined;
  }

  private mapEventFromFirestore(data: FirestoreCalendarEvent): CalendarEvent {
    return {
      ...data,
      startDate: this.toDate(data.startDate),
      endDate: this.toDate(data.endDate),
      recurring: data.recurring ? this.mapRecurringPattern(data.recurring) : undefined
    };
  }

  private mapRecurringPattern(pattern: FirestoreRecurringPattern): RecurringPattern {
    const recurring: RecurringPattern = {
      frequency: pattern.frequency,
      ...(pattern.daysOfWeek ? { daysOfWeek: [...pattern.daysOfWeek] } : {})
    };

    if (pattern.endDate) {
      recurring.endDate = this.toDate(pattern.endDate);
    }

    return recurring;
  }

  private mapScheduleFromFirestore(data: FirestoreCustodySchedule & { id: string }): CustodySchedule {
    return {
      ...data,
      startDate: this.toDate(data.startDate),
      endDate: data.endDate ? this.toDate(data.endDate) : undefined
    };
  }

  private toDate(value: Timestamp | Date | string | number): Date {
    if (value instanceof Timestamp) {
      return value.toDate();
    }
    if (value instanceof Date) {
      return value;
    }
    return new Date(value);
  }

  private requireFamilyId(): string {
    const familyId = this.activeFamilyIdSubject.value;
    if (!familyId) {
      throw new Error('missing-family-context');
    }
    return familyId;
  }

  // ========= Calendar UI helpers =========

  generateCalendarDays(year: number, month: number): CalendarDay[] {
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const days: CalendarDay[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 42; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

      const dayEvents = this.getEventsForDay(currentDate);
      const primaryParent = this.resolvePrimaryParentForDate(currentDate, dayEvents);

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

  /**
   * מחזיר את כל האירועים ליום נתון לפי ה-Snapshot האחרון
   */
  getEventsForDay(date: Date): CalendarEvent[] {
    const events = this.eventsSubject.value;
    return events.filter(event => {
      const eventDate = new Date(event.startDate);
      eventDate.setHours(0, 0, 0, 0);
      const checkDate = new Date(date);
      checkDate.setHours(0, 0, 0, 0);

      if (event.isAllDay) {
        return eventDate.getTime() === checkDate.getTime();
      }

      const endDate = new Date(event.endDate);
      endDate.setHours(0, 0, 0, 0);
      return checkDate >= eventDate && checkDate <= endDate;
    });
  }

  getCustodyDetailsForDate(date: Date): CustodyToday | null {
    const dayEvents = this.getEventsForDay(date);
    const currentParent = this.resolvePrimaryParentForDate(date, dayEvents);

    if (!currentParent) {
      return null;
    }

    const nextTransition = this.findNextCustodyTransition(date, currentParent);

    return {
      currentParent,
      currentParentName: this.getParentDisplayName(currentParent),
      nextTransition
    };
  }

  getParentForDate(date: Date): 'parent1' | 'parent2' | undefined {
    return this.resolvePrimaryParentForDate(date, this.getEventsForDay(date));
  }

  private resolvePrimaryParentForDate(date: Date, events: CalendarEvent[]): 'parent1' | 'parent2' | undefined {
    const custodyEvent = events.find(e => e.type === EventType.CUSTODY);
    if (custodyEvent && custodyEvent.parentId !== 'both') {
      return custodyEvent.parentId;
    }

    return this.getCustodyParentFromSchedule(date);
  }

  private getCustodyParentFromSchedule(date: Date): 'parent1' | 'parent2' | undefined {
    const schedule = this.custodyScheduleSubject.value;
    if (!schedule || !schedule.isActive) {
      return undefined;
    }

    const startDate = new Date(schedule.startDate);
    startDate.setHours(0, 0, 0, 0);

    const endDate = schedule.endDate ? new Date(schedule.endDate) : undefined;
    if (endDate) {
      endDate.setHours(0, 0, 0, 0);
    }

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    if (targetDate < startDate || (endDate && targetDate > endDate)) {
      return undefined;
    }

    const diffDays = Math.floor((targetDate.getTime() - startDate.getTime()) / CalendarService.DAY_IN_MS);
    const parent1Days = schedule.parent1Days ?? [];
    const parent2Days = schedule.parent2Days ?? [];
    const dayOfWeek = targetDate.getDay();

    switch (schedule.pattern) {
      case CustodyPattern.WEEKLY:
      case CustodyPattern.CUSTOM:
        if (parent1Days.includes(dayOfWeek)) {
          return 'parent1';
        }
        if (parent2Days.includes(dayOfWeek)) {
          return 'parent2';
        }
        break;
      case CustodyPattern.BIWEEKLY: {
        const weekIndex = Math.floor(diffDays / 7);
        const isEvenWeek = weekIndex % 2 === 0;
        const primaryDays = isEvenWeek ? parent1Days : parent2Days;
        const secondaryDays = isEvenWeek ? parent2Days : parent1Days;

        if (primaryDays.includes(dayOfWeek)) {
          return isEvenWeek ? 'parent1' : 'parent2';
        }

        if (secondaryDays.includes(dayOfWeek)) {
          return isEvenWeek ? 'parent2' : 'parent1';
        }
        break;
      }
      case CustodyPattern.WEEK_ON_WEEK_OFF: {
        const weekIndex = Math.floor(diffDays / 7);
        return weekIndex % 2 === 0 ? 'parent1' : 'parent2';
      }
    }

    return undefined;
  }

  private findNextCustodyTransition(
    date: Date,
    currentParent: 'parent1' | 'parent2'
  ): CustodyToday['nextTransition'] | undefined {
    const lookAheadDays = 60;

    for (let offset = 1; offset <= lookAheadDays; offset++) {
      const checkDate = new Date(date);
      checkDate.setDate(checkDate.getDate() + offset);
      const nextParent = this.resolvePrimaryParentForDate(checkDate, this.getEventsForDay(checkDate));

      if (nextParent && nextParent !== currentParent) {
        return {
          date: checkDate,
          toParent: nextParent,
          toParentName: this.getParentDisplayName(nextParent),
          type: 'pickup'
        };
      }
    }

    return undefined;
  }

  private getParentDisplayName(parent: 'parent1' | 'parent2'): string {
    return parent === 'parent1' ? 'הורה 1' : 'הורה 2';
  }

  addEvent(event: Omit<CalendarEvent, 'id'>): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');

    return addDoc(eventsRef, {
      ...this.serializeEvent(event),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }).then(() => undefined);
  }

  updateEvent(id: string, updates: Partial<Omit<CalendarEvent, 'id'>>): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventRef = doc(this.firestore, 'families', familyId, 'calendarEvents', id);

    return updateDoc(eventRef, {
      ...this.serializeEvent(updates),
      updatedAt: serverTimestamp()
    });
  }

  deleteEvent(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventRef = doc(this.firestore, 'families', familyId, 'calendarEvents', id);
    return deleteDoc(eventRef);
  }

  nextMonth(): void {
    const current = this.currentMonthSubject.value;
    const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    this.currentMonthSubject.next(next);
  }

  previousMonth(): void {
    const current = this.currentMonthSubject.value;
    const prev = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    this.currentMonthSubject.next(prev);
  }

  // ========= Custody Schedule =========

  async saveCustodySchedule(schedule: CustodySchedule): Promise<void> {
    const familyId = this.requireFamilyId();
    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');
    const payload = this.serializeSchedule(schedule);

    await setDoc(scheduleRef, {
      ...payload,
      updatedAt: serverTimestamp()
    });

    await this.deleteOldCustodyEvents(familyId);
  }

  async deleteCustodySchedule(): Promise<void> {
    const familyId = this.requireFamilyId();
    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');
    await deleteDoc(scheduleRef);
    await this.deleteOldCustodyEvents(familyId);
  }

  // ========= Swap Request Overrides =========

  async applySwapRequestApproval(request: SwapRequest): Promise<void> {
    const familyId = this.requireFamilyId();
    const originalParent = this.getParentForDate(request.originalDate);
    const proposedParent = this.getParentForDate(request.proposedDate);

    if (!originalParent || !proposedParent) {
      return;
    }

    await this.removeSwapRequestOverrides(request.id);

    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const overrides: Array<Omit<CalendarEvent, 'id'>> = [
      this.buildSwapOverrideEvent(request, request.originalDate, proposedParent, 'יום שהועבר'),
      this.buildSwapOverrideEvent(request, request.proposedDate, originalParent, 'יום שהתקבל')
    ];

    const ops = overrides.map(event =>
      addDoc(eventsRef, {
        ...this.serializeEvent(event),
        swapRequestId: request.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    await Promise.all(ops);
  }

  async removeSwapRequestOverrides(requestId: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const overridesQuery = query(eventsRef, where('swapRequestId', '==', requestId));
    const snapshot = await getDocs(overridesQuery);

    if (snapshot.empty) {
      return;
    }

    await Promise.all(snapshot.docs.map(docSnap => deleteDoc(docSnap.ref)));
  }

  private buildSwapOverrideEvent(
    request: SwapRequest,
    date: Date,
    parentId: 'parent1' | 'parent2',
    suffix: string
  ): Omit<CalendarEvent, 'id'> {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);

    return {
      title: `החלפת משמרת מאושרת - ${suffix}`,
      description: request.reason || 'החלפה שאושרה בין ההורים',
      startDate,
      endDate,
      isAllDay: true,
      type: EventType.CUSTODY,
      parentId,
      color: '#8b5cf6',
      swapRequestId: request.id
    };
  }

  // ========= Internal helpers =========

  private serializeEvent(event: Partial<Omit<CalendarEvent, 'id'>>): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...event };

    if (event.startDate) {
      payload['startDate'] = Timestamp.fromDate(new Date(event.startDate));
    }

    if (event.endDate) {
      payload['endDate'] = Timestamp.fromDate(new Date(event.endDate));
    }

    if (event.recurring) {
      payload['recurring'] = {
        ...event.recurring,
        endDate: event.recurring.endDate ? Timestamp.fromDate(new Date(event.recurring.endDate)) : null
      };
    }

    return payload;
  }

  private serializeSchedule(schedule: CustodySchedule): Record<string, unknown> {
    return {
      ...schedule,
      startDate: Timestamp.fromDate(new Date(schedule.startDate)),
      endDate: schedule.endDate ? Timestamp.fromDate(new Date(schedule.endDate)) : null
    };
  }

  private async deleteOldCustodyEvents(familyId: string): Promise<void> {
    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const custodyQuery = query(eventsRef, where('type', '==', EventType.CUSTODY));
    const snapshot = await getDocs(custodyQuery);

    if (snapshot.empty) {
      return;
    }

    const commits: Promise<void>[] = [];
    let batch = writeBatch(this.firestore);
    let counter = 0;

    snapshot.docs.forEach(docSnap => {
      batch.delete(docSnap.ref);
      counter++;

      if (counter === 450) {
        commits.push(batch.commit());
        batch = writeBatch(this.firestore);
        counter = 0;
      }
    });

    if (counter > 0) {
      commits.push(batch.commit());
    }

    await Promise.all(commits);
  }

}
