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
  getDoc,
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
import { CustodySchedule, CustodyPattern, CustodyScheduleApprovalRequest } from '../models/custody-schedule.model';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { SwapRequest } from '../models/swap-request.model';
import { Family } from '../models/family.model';
import { UserProfile } from '../models/user-profile.model';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { useServerBackend } from './backend-mode';

type FirestoreRecurringPattern = Omit<RecurringPattern, 'endDate'> & {
  endDate?: Timestamp | null;
};

type FirestoreCalendarEvent = Omit<CalendarEvent, 'startDate' | 'endDate' | 'recurring' | 'createdAt' | 'updatedAt'> & {
  startDate: Timestamp;
  endDate: Timestamp;
  recurring?: FirestoreRecurringPattern;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

type FirestoreCustodySchedule = Omit<CustodySchedule, 'startDate' | 'endDate'> & {
  startDate: Timestamp;
  endDate?: Timestamp | null;
  pendingApproval?: FirestorePendingApproval | null;
};

type FirestorePendingApproval = Omit<CustodyScheduleApprovalRequest, 'startDate' | 'requestedAt'> & {
  startDate: Timestamp;
  requestedAt: Timestamp;
};

// Server API types
interface ServerCalendarEvent {
  id: string;
  familyId: string;
  title: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  type: EventType;
  parentId: 'parent1' | 'parent2' | 'both';
  color?: string | null;
  location?: string | null;
  childId?: string | null;
  swapRequestId?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface ServerCustodySchedule {
  id: string;
  familyId: string;
  name: string;
  pattern: CustodyPattern;
  startDate: string;
  endDate?: string | null;
  parent1Days: number[];
  parent2Days: number[];
  biweeklyAltParent1Days?: number[];
  biweeklyAltParent2Days?: number[];
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface ParentMetadataEntry {
  uid?: string;
  name: string;
  photoUrl?: string | null;
}

interface ParentMetadata {
  parent1: ParentMetadataEntry;
  parent2: ParentMetadataEntry;
}

interface SaveCustodyOptions {
  requestApproval?: boolean;
  baseSchedule?: CustodySchedule | null;
  requestedBy?: string | null;
  requestedByName?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class CalendarService implements OnDestroy {
  private static readonly DAY_IN_MS = 24 * 60 * 60 * 1000;
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly apiService = inject(ApiService);
  private readonly socketService = inject(SocketService);

  private eventsSubject = new BehaviorSubject<CalendarEvent[]>([]);
  readonly events$: Observable<CalendarEvent[]> = this.eventsSubject.asObservable();

  private currentMonthSubject = new BehaviorSubject<Date>(new Date());
  readonly currentMonth$: Observable<Date> = this.currentMonthSubject.asObservable();

  private custodyScheduleSubject = new BehaviorSubject<CustodySchedule | null>(null);
  readonly custodySchedule$: Observable<CustodySchedule | null> = this.custodyScheduleSubject.asObservable();

  private activeFamilyIdSubject = new BehaviorSubject<string | null>(null);
  readonly activeFamilyId$: Observable<string | null> = this.activeFamilyIdSubject.asObservable();

  private parentMetadataSubject = new BehaviorSubject<ParentMetadata>(this.createDefaultParentMetadata());
  readonly parentMetadata$ = this.parentMetadataSubject.asObservable();
  private familyChildrenSubject = new BehaviorSubject<string[]>([]);
  readonly familyChildren$ = this.familyChildrenSubject.asObservable();

  private profileSubscription?: Subscription;
  private eventsSubscription?: Subscription;
  private custodySubscription?: Subscription;
  private familyMetadataSubscription?: Subscription;
  private socketSubscription?: Subscription;
  private currentProfile: UserProfile | null = null;
  private currentUserId: string | null = null;
  private memberProfileCache = new Map<string, UserProfile>();
  private parentMetadataRequestId = 0;

  constructor() {
    this.profileSubscription = this.authService.user$
      .pipe(
        switchMap(user => (user ? this.userProfileService.listenToProfile(user.uid) : of(null))),
        distinctUntilChanged((prev, curr) => prev?.activeFamilyId === curr?.activeFamilyId)
      )
      .subscribe(profile => {
        this.currentProfile = profile;
        this.currentUserId = profile?.uid ?? null;
        const familyId = profile?.activeFamilyId ?? null;
        this.activeFamilyIdSubject.next(familyId);
        this.subscribeToFamilyData(familyId);
      });
  }

  ngOnDestroy() {
    this.profileSubscription?.unsubscribe();
    this.detachFamilyListeners();
  }

  getFamilyChildren(): Observable<string[]> {
    return this.familyChildren$;
  }

  // ========= PUBLIC API =========

  addEvent(event: Omit<CalendarEvent, 'id'>): Promise<void> {
    if (useServerBackend()) {
      return this.addEventServer(event);
    }
    return this.addEventFirebase(event);
  }

  updateEvent(id: string, updates: Partial<Omit<CalendarEvent, 'id'>>): Promise<void> {
    if (useServerBackend()) {
      return this.updateEventServer(id, updates);
    }
    return this.updateEventFirebase(id, updates);
  }

  deleteEvent(id: string): Promise<void> {
    if (useServerBackend()) {
      return this.deleteEventServer(id);
    }
    return this.deleteEventFirebase(id);
  }

  async saveCustodySchedule(schedule: CustodySchedule, options?: SaveCustodyOptions): Promise<void> {
    if (useServerBackend()) {
      return this.saveCustodyScheduleServer(schedule, options);
    }
    return this.saveCustodyScheduleFirebase(schedule, options);
  }

  async deleteCustodySchedule(): Promise<void> {
    if (useServerBackend()) {
      return this.deleteCustodyScheduleServer();
    }
    return this.deleteCustodyScheduleFirebase();
  }

  async respondToCustodyApproval(approve: boolean): Promise<void> {
    if (useServerBackend()) {
      return this.respondToCustodyApprovalServer(approve);
    }
    return this.respondToCustodyApprovalFirebase(approve);
  }

  async cancelCustodyApprovalRequest(): Promise<void> {
    if (useServerBackend()) {
      return this.cancelCustodyApprovalRequestServer();
    }
    return this.cancelCustodyApprovalRequestFirebase();
  }

  // ========= SERVER BACKEND METHODS =========

  private async addEventServer(event: Omit<CalendarEvent, 'id'>): Promise<void> {
    const familyId = this.requireFamilyId();
    const createdByName = this.getCurrentUserDisplayName();

    const payload = {
      title: event.title,
      description: event.description || null,
      startDate: new Date(event.startDate).toISOString(),
      endDate: new Date(event.endDate).toISOString(),
      isAllDay: event.isAllDay ?? false,
      type: event.type,
      parentId: event.parentId,
      color: event.color || null,
      location: event.location || null,
      childId: event.childId || null,
      createdByName
    };

    const created = await this.apiService.post<ServerCalendarEvent>(`/calendar/${familyId}/events`, payload).toPromise();
    
    // Update local state immediately
    if (created) {
      const calEvent = this.mapServerEvent(created);
      const current = this.eventsSubject.value;
      this.eventsSubject.next([...current, calEvent]);
    }
  }

  private async updateEventServer(id: string, updates: Partial<Omit<CalendarEvent, 'id'>>): Promise<void> {
    const familyId = this.requireFamilyId();

    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload['title'] = updates.title;
    if (updates.description !== undefined) payload['description'] = updates.description || null;
    if (updates.startDate !== undefined) payload['startDate'] = new Date(updates.startDate).toISOString();
    if (updates.endDate !== undefined) payload['endDate'] = new Date(updates.endDate).toISOString();
    if (updates.isAllDay !== undefined) payload['isAllDay'] = updates.isAllDay;
    if (updates.type !== undefined) payload['type'] = updates.type;
    if (updates.parentId !== undefined) payload['parentId'] = updates.parentId;
    if (updates.color !== undefined) payload['color'] = updates.color || null;
    if (updates.location !== undefined) payload['location'] = updates.location || null;
    if (updates.childId !== undefined) payload['childId'] = updates.childId || null;

    const updated = await this.apiService.patch<ServerCalendarEvent>(`/calendar/${familyId}/events/${id}`, payload).toPromise();
    
    // Update local state immediately
    if (updated) {
      const calEvent = this.mapServerEvent(updated);
      const current = this.eventsSubject.value;
      const index = current.findIndex(e => e.id === id);
      if (index >= 0) {
        const next = [...current];
        next[index] = calEvent;
        this.eventsSubject.next(next);
      }
    }
  }

  private async deleteEventServer(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.delete(`/calendar/${familyId}/events/${id}`).toPromise();
    
    // Update local state immediately
    const current = this.eventsSubject.value;
    this.eventsSubject.next(current.filter(e => e.id !== id));
  }

  private async saveCustodyScheduleServer(schedule: CustodySchedule, options?: SaveCustodyOptions): Promise<void> {
    const familyId = this.requireFamilyId();

    const payload = {
      name: schedule.name,
      pattern: schedule.pattern,
      startDate: new Date(schedule.startDate).toISOString(),
      endDate: schedule.endDate ? new Date(schedule.endDate).toISOString() : null,
      parent1Days: schedule.parent1Days,
      parent2Days: schedule.parent2Days,
      biweeklyAltParent1Days: schedule.biweeklyAltParent1Days ?? [],
      biweeklyAltParent2Days: schedule.biweeklyAltParent2Days ?? [],
      isActive: schedule.isActive ?? true,
      requestApproval: options?.requestApproval ?? false,
      requestedByName: options?.requestedByName || this.getCurrentUserDisplayName()
    };

    await this.apiService.put(`/calendar/${familyId}/custody`, payload).toPromise();
  }

  private async deleteCustodyScheduleServer(): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.delete(`/calendar/${familyId}/custody`).toPromise();
  }

  private async respondToCustodyApprovalServer(approve: boolean): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.post(`/calendar/${familyId}/custody/approve`, { approve }).toPromise();
  }

  private async cancelCustodyApprovalRequestServer(): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.post(`/calendar/${familyId}/custody/cancel`, {}).toPromise();
  }

  private async loadEventsFromServer(familyId: string): Promise<void> {
    try {
      console.log('[Calendar] Loading events from server for family:', familyId);
      const events = await this.apiService.get<ServerCalendarEvent[]>(`/calendar/${familyId}/events`).toPromise();
      console.log('[Calendar] Loaded events from server:', events?.length || 0);
      const mapped = (events || []).map(e => this.mapServerEvent(e));
      this.eventsSubject.next(mapped);
    } catch (error) {
      console.error('[Calendar] Failed to load events from server', error);
    }
  }

  private async loadCustodyFromServer(familyId: string): Promise<void> {
    try {
      const custody = await this.apiService.get<ServerCustodySchedule>(`/calendar/${familyId}/custody`).toPromise();
      if (custody) {
        this.custodyScheduleSubject.next(this.mapServerCustody(custody));
      } else {
        this.custodyScheduleSubject.next(null);
      }
    } catch (error) {
      console.error('[Calendar] Failed to load custody from server', error);
      this.custodyScheduleSubject.next(null);
    }
  }

  private subscribeToServerEvents(familyId: string): void {
    this.socketSubscription?.unsubscribe();

    this.socketSubscription = this.socketService.allEvents$.subscribe(({ event, data }) => {
      console.log('[Calendar] Socket event received:', event, data);
      if (event === 'event:created') {
        const calEvent = this.mapServerEvent(data as ServerCalendarEvent);
        const current = this.eventsSubject.value;
        // Only add if not already exists (avoid duplicates from local add)
        if (!current.some(e => e.id === calEvent.id)) {
          this.eventsSubject.next([...current, calEvent]);
        }
      } else if (event === 'event:updated') {
        const calEvent = this.mapServerEvent(data as ServerCalendarEvent);
        const current = this.eventsSubject.value;
        const index = current.findIndex(e => e.id === calEvent.id);
        if (index >= 0) {
          const next = [...current];
          next[index] = calEvent;
          this.eventsSubject.next(next);
        }
      } else if (event === 'event:deleted') {
        const { id } = data as { id: string };
        const next = this.eventsSubject.value.filter(e => e.id !== id);
        this.eventsSubject.next(next);
      } else if (event === 'custody:updated') {
        const custody = this.mapServerCustody(data as ServerCustodySchedule);
        this.custodyScheduleSubject.next(custody);
      } else if (event === 'custody:deleted') {
        this.custodyScheduleSubject.next(null);
      }
    });
  }

  private mapServerEvent(data: ServerCalendarEvent): CalendarEvent {
    return {
      id: data.id,
      title: data.title,
      description: data.description || undefined,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      isAllDay: data.isAllDay,
      type: data.type,
      parentId: data.parentId,
      color: data.color || undefined,
      location: data.location || undefined,
      childId: data.childId || undefined,
      swapRequestId: data.swapRequestId || undefined,
      createdBy: data.createdById || undefined,
      createdByName: data.createdByName || undefined,
      createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined
    };
  }

  private mapServerCustody(data: ServerCustodySchedule): CustodySchedule {
    return {
      id: data.id,
      name: data.name,
      pattern: data.pattern,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      parent1Days: data.parent1Days,
      parent2Days: data.parent2Days,
      biweeklyAltParent1Days: data.biweeklyAltParent1Days ?? [],
      biweeklyAltParent2Days: data.biweeklyAltParent2Days ?? [],
      isActive: data.isActive,
      pendingApproval: null // TODO: Handle pending approval from server
    };
  }

  // ========= FIREBASE BACKEND METHODS =========

  private addEventFirebase(event: Omit<CalendarEvent, 'id'>): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');

    const targetUids = this.resolveEventTargetUids(event.parentId);
    const createdBy = this.currentUserId ?? 'unknown';
    const createdByName = this.getCurrentUserDisplayName();

    return addDoc(eventsRef, {
      ...this.serializeEvent({ ...event, targetUids, createdBy, createdByName }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }).then(() => undefined);
  }

  private updateEventFirebase(id: string, updates: Partial<Omit<CalendarEvent, 'id'>>): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventRef = doc(this.firestore, 'families', familyId, 'calendarEvents', id);

    const targetUids = updates.parentId ? this.resolveEventTargetUids(updates.parentId) : undefined;

    return updateDoc(eventRef, {
      ...this.serializeEvent({ ...updates, ...(targetUids ? { targetUids } : {}) }),
      updatedAt: serverTimestamp()
    });
  }

  private deleteEventFirebase(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventRef = doc(this.firestore, 'families', familyId, 'calendarEvents', id);
    return deleteDoc(eventRef);
  }

  private async saveCustodyScheduleFirebase(schedule: CustodySchedule, options?: SaveCustodyOptions): Promise<void> {
    const familyId = this.requireFamilyId();
    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');
    let scheduleToPersist: CustodySchedule;

    if (options?.requestApproval) {
      const baseSchedule = options.baseSchedule ?? schedule;
      const hasExistingSchedule = !!options.baseSchedule;
      scheduleToPersist = {
        ...baseSchedule,
        pendingApproval: this.buildApprovalRequest(schedule, options.requestedBy, options.requestedByName),
        isActive: hasExistingSchedule ? baseSchedule.isActive ?? true : false
      };
    } else {
      scheduleToPersist = {
        ...schedule,
        pendingApproval: null,
        isActive: schedule.isActive ?? true
      };
    }

    const payload = this.serializeSchedule(scheduleToPersist);

    await setDoc(scheduleRef, {
      ...payload,
      updatedAt: serverTimestamp()
    });

    if (!options?.requestApproval) {
      await this.deleteOldCustodyEvents(familyId);
    }
  }

  private async deleteCustodyScheduleFirebase(): Promise<void> {
    const familyId = this.requireFamilyId();
    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');
    await deleteDoc(scheduleRef);
    await this.deleteOldCustodyEvents(familyId);
  }

  private async respondToCustodyApprovalFirebase(approve: boolean): Promise<void> {
    const pendingSchedule = this.custodyScheduleSubject.value;
    if (!pendingSchedule?.pendingApproval) {
      return;
    }

    const pending = pendingSchedule.pendingApproval;
    if (pending.requestedBy === this.currentUserId) {
      throw new Error('requester-cannot-approve');
    }

    const familyId = this.requireFamilyId();
    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');

    const nextSchedule: CustodySchedule = approve
      ? {
          ...pendingSchedule,
          ...pending,
          startDate: new Date(pending.startDate),
          parent1Days: [...pending.parent1Days],
          parent2Days: [...pending.parent2Days],
          pendingApproval: null,
          isActive: true
        }
      : {
          ...pendingSchedule,
          pendingApproval: null
        };

    const payload = this.serializeSchedule(nextSchedule);
    await setDoc(scheduleRef, {
      ...payload,
      updatedAt: serverTimestamp()
    });

    if (approve) {
      await this.deleteOldCustodyEvents(familyId);
    }
  }

  private async cancelCustodyApprovalRequestFirebase(): Promise<void> {
    const schedule = this.custodyScheduleSubject.value;
    if (!schedule?.pendingApproval) {
      return;
    }

    if (schedule.pendingApproval.requestedBy !== this.currentUserId) {
      throw new Error('only-requester-can-cancel');
    }

    const familyId = this.requireFamilyId();
    const scheduleRef = doc(this.firestore, 'families', familyId, 'settings', 'custodySchedule');
    const nextSchedule: CustodySchedule = {
      ...schedule,
      pendingApproval: null
    };

    const payload = this.serializeSchedule(nextSchedule);
    await setDoc(scheduleRef, {
      ...payload,
      updatedAt: serverTimestamp()
    });
  }

  // ========= SUBSCRIPTION LOGIC =========

  private subscribeToFamilyData(familyId: string | null) {
    this.detachFamilyListeners();
    this.memberProfileCache.clear();
    this.parentMetadataRequestId++;

    if (!familyId) {
      this.eventsSubject.next([]);
      this.custodyScheduleSubject.next(null);
      this.parentMetadataSubject.next(this.createDefaultParentMetadata());
      this.familyChildrenSubject.next([]);
      return;
    }

    if (useServerBackend()) {
      // Connect to socket first, then join family room, then load data
      this.socketService.connect().then(() => {
        this.socketService.joinFamily(familyId);
        this.loadEventsFromServer(familyId);
        this.loadCustodyFromServer(familyId);
        this.subscribeToServerEvents(familyId);
      });
    } else {
      this.subscribeToFirebaseData(familyId);
    }
  }

  private subscribeToFirebaseData(familyId: string): void {
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

    const familyRef = doc(this.firestore, 'families', familyId);
    this.familyMetadataSubscription = docSnapshots(familyRef).subscribe(snapshot => {
      if (!snapshot.exists()) {
        this.parentMetadataSubject.next(this.createDefaultParentMetadata());
        this.familyChildrenSubject.next([]);
        return;
      }

      const data = snapshot.data() as Family;
      this.familyChildrenSubject.next(data.children ?? []);
      this.updateParentMetadata(data.members ?? []);
    });
  }

  private detachFamilyListeners() {
    this.eventsSubscription?.unsubscribe();
    this.eventsSubscription = undefined;
    this.custodySubscription?.unsubscribe();
    this.custodySubscription = undefined;
    this.familyMetadataSubscription?.unsubscribe();
    this.familyMetadataSubscription = undefined;
    this.socketSubscription?.unsubscribe();
    this.socketSubscription = undefined;
    this.familyChildrenSubject.next([]);
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

  getEventById(eventId: string): CalendarEvent | undefined {
    return this.eventsSubject.value.find(event => event.id === eventId);
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

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  getCurrentUserDisplayName(): string {
    return this.currentProfile?.fullName || this.currentProfile?.email || 'הורה';
  }

  getParentMetadataSnapshot(): ParentMetadata {
    return this.parentMetadataSubject.value;
  }

  getParentRoleForUser(uid?: string | null): 'parent1' | 'parent2' | null {
    if (!uid) {
      return null;
    }

    const metadata = this.parentMetadataSubject.value;
    if (metadata.parent1.uid === uid) {
      return 'parent1';
    }

    if (metadata.parent2.uid === uid) {
      return 'parent2';
    }

    return null;
  }

  hasBothParents(): boolean {
    const metadata = this.parentMetadataSubject.value;
    return Boolean(metadata.parent1.uid && metadata.parent2.uid);
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

  setMonth(date: Date): void {
    const normalized = new Date(date.getFullYear(), date.getMonth(), 1);
    this.currentMonthSubject.next(normalized);
  }

  // ========= Swap Request Overrides =========

  async applySwapRequestApproval(request: SwapRequest): Promise<void> {
    // TODO: Implement server version
    if (useServerBackend()) {
      console.warn('[Calendar] applySwapRequestApproval not yet implemented for server backend');
      return;
    }
    return this.applySwapRequestApprovalFirebase(request);
  }

  async removeSwapRequestOverrides(requestId: string): Promise<void> {
    // TODO: Implement server version
    if (useServerBackend()) {
      console.warn('[Calendar] removeSwapRequestOverrides not yet implemented for server backend');
      return;
    }
    return this.removeSwapRequestOverridesFirebase(requestId);
  }

  private async applySwapRequestApprovalFirebase(request: SwapRequest): Promise<void> {
    const familyId = this.requireFamilyId();
    const originalParent = this.getParentForDate(request.originalDate);
    const proposedParent = request.proposedDate ? this.getParentForDate(request.proposedDate) : undefined;
    const requestedToParent = this.getParentRoleForUser(request.requestedTo);

    if (!originalParent) {
      return;
    }

    await this.removeSwapRequestOverridesFirebase(request.id);
    await this.removeSwapOverridesForDates([
      request.originalDate,
      ...(request.proposedDate ? [request.proposedDate] : [])
    ]);

    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const overrides: Array<Omit<CalendarEvent, 'id'>> = [];

    if (request.requestType === 'one-way' || !request.proposedDate) {
      const targetParent = requestedToParent ?? (originalParent === 'parent1' ? 'parent2' : 'parent1');
      if (!targetParent) {
        return;
      }
      overrides.push(
        this.buildSwapOverrideEvent(request, request.originalDate, targetParent, 'יום שהועבר ללא החזרה')
      );
    } else {
      if (!proposedParent) {
        return;
      }
      overrides.push(
        this.buildSwapOverrideEvent(request, request.originalDate, proposedParent, 'יום שהועבר'),
        this.buildSwapOverrideEvent(request, request.proposedDate, originalParent, 'יום שהתקבל')
      );
    }

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

  private async removeSwapRequestOverridesFirebase(requestId: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const overridesQuery = query(eventsRef, where('swapRequestId', '==', requestId));
    const snapshot = await getDocs(overridesQuery);

    if (snapshot.empty) {
      return;
    }

    await Promise.all(snapshot.docs.map(docSnap => deleteDoc(docSnap.ref)));
  }

  private async removeSwapOverridesForDates(dates: Date[]): Promise<void> {
    const familyId = this.requireFamilyId();
    if (!dates.length) {
      return;
    }

    const normalizedTargets = new Set(
      dates.map(date => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })
    );

    const eventsRef = collection(this.firestore, 'families', familyId, 'calendarEvents');
    const snapshot = await getDocs(query(eventsRef, where('swapRequestId', '!=', null)));

    const deletes = snapshot.docs.filter(docSnap => {
      const data = docSnap.data() as any;
      if (!data.swapRequestId) {
        return false;
      }
      const start = this.toDate((data as any).startDate);
      start.setHours(0, 0, 0, 0);
      return normalizedTargets.has(start.getTime());
    });

    if (!deletes.length) {
      return;
    }

    await Promise.all(deletes.map(docSnap => deleteDoc(docSnap.ref)));
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
        const altParent1 = schedule.biweeklyAltParent1Days ?? null;
        const altParent2 = schedule.biweeklyAltParent2Days ?? null;

        const hasAlt =
          (altParent1 && altParent1.length > 0) || (altParent2 && altParent2.length > 0);

        const activeParent1Days =
          !hasAlt || isEvenWeek ? parent1Days : altParent1 ?? [];
        const activeParent2Days =
          !hasAlt || isEvenWeek ? parent2Days : altParent2 ?? [];

        if (activeParent1Days.includes(dayOfWeek)) {
          return 'parent1';
        }
        if (activeParent2Days.includes(dayOfWeek)) {
          return 'parent2';
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
    const metadata = this.parentMetadataSubject.value;
    return metadata[parent].name || (parent === 'parent1' ? 'הורה 1' : 'הורה 2');
  }

  private async updateParentMetadata(memberIds: string[]) {
    const requestId = ++this.parentMetadataRequestId;

    if (!memberIds?.length) {
      this.parentMetadataSubject.next(this.createDefaultParentMetadata());
      return;
    }

    const unique = Array.from(new Set(memberIds)).sort();
    const [parent1Uid, parent2Uid] = unique;

    const [parent1Profile, parent2Profile] = await Promise.all([
      this.fetchMemberProfile(parent1Uid),
      this.fetchMemberProfile(parent2Uid)
    ]);

    const resolveName = (uid?: string, profile?: UserProfile | null): string => {
      if (uid && this.currentProfile?.uid === uid) {
        return (
          this.currentProfile.fullName ||
          (this.currentProfile as any)?.displayName ||
          this.currentProfile.email ||
          'הורה'
        );
      }
      return (
        profile?.fullName ||
        (profile as any)?.displayName ||
        profile?.email ||
        'הורה'
      );
    };

    const resolvePhoto = (uid?: string, profile?: UserProfile | null): string | null => {
      if (uid && this.currentProfile?.uid === uid) {
        return this.currentProfile.photoUrl ?? null;
      }
      return profile?.photoUrl ?? null;
    };

    if (requestId !== this.parentMetadataRequestId) {
      return;
    }

    this.parentMetadataSubject.next({
      parent1: {
        uid: parent1Uid,
        name: resolveName(parent1Uid, parent1Profile) || 'הורה 1',
        photoUrl: resolvePhoto(parent1Uid, parent1Profile)
      },
      parent2: {
        uid: parent2Uid,
        name: resolveName(parent2Uid, parent2Profile) || 'הורה 2',
        photoUrl: resolvePhoto(parent2Uid, parent2Profile)
      }
    });
  }

  private async fetchMemberProfile(uid?: string): Promise<UserProfile | null> {
    if (!uid) {
      return null;
    }

    if (this.memberProfileCache.has(uid)) {
      return this.memberProfileCache.get(uid)!;
    }

    try {
      const snapshot = await getDoc(doc(this.firestore, 'users', uid));
      if (!snapshot.exists()) {
        return null;
      }

      const profile = snapshot.data() as UserProfile;
      this.memberProfileCache.set(uid, profile);
      return profile;
    } catch (error) {
      console.error('Failed to fetch member profile', error);
      return null;
    }
  }

  private buildApprovalRequest(
    schedule: CustodySchedule,
    requestedBy?: string | null,
    requestedByName?: string | null
  ): CustodyScheduleApprovalRequest {
    return {
      name: schedule.name,
      pattern: schedule.pattern,
      startDate: new Date(schedule.startDate),
      parent1Days: [...schedule.parent1Days],
      parent2Days: [...schedule.parent2Days],
      requestedBy: requestedBy ?? null,
      requestedByName,
      requestedAt: new Date()
    };
  }

  private createDefaultParentMetadata(): ParentMetadata {
    return {
      parent1: { name: 'הורה 1', photoUrl: null },
      parent2: { name: 'הורה 2', photoUrl: null }
    };
  }

  private resolveEventTargetUids(parentId: 'parent1' | 'parent2' | 'both'): string[] {
    const metadata = this.parentMetadataSubject.value;
    const targets: string[] = [];

    if (parentId === 'both') {
      if (metadata.parent1.uid) {
        targets.push(metadata.parent1.uid);
      }
      if (metadata.parent2.uid && metadata.parent2.uid !== metadata.parent1.uid) {
        targets.push(metadata.parent2.uid);
      }
    } else if (parentId === 'parent1' && metadata.parent1.uid) {
      targets.push(metadata.parent1.uid);
    } else if (parentId === 'parent2' && metadata.parent2.uid) {
      targets.push(metadata.parent2.uid);
    }

    return targets;
  }

  private mapEventFromFirestore(data: FirestoreCalendarEvent): CalendarEvent {
    return {
      ...data,
      startDate: this.toDate(data.startDate),
      endDate: this.toDate(data.endDate),
      recurring: data.recurring ? this.mapRecurringPattern(data.recurring) : undefined,
      createdAt: data.createdAt ? this.toDate(data.createdAt) : undefined,
      updatedAt: data.updatedAt ? this.toDate(data.updatedAt) : undefined
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
      endDate: data.endDate ? this.toDate(data.endDate) : undefined,
      biweeklyAltParent1Days: data.biweeklyAltParent1Days ?? [],
      biweeklyAltParent2Days: data.biweeklyAltParent2Days ?? [],
      pendingApproval: data.pendingApproval
        ? {
            ...data.pendingApproval,
            startDate: this.toDate(data.pendingApproval.startDate),
            requestedAt: this.toDate(data.pendingApproval.requestedAt)
          }
        : null
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

    if (event.targetUids) {
      payload['targetUids'] = [...event.targetUids];
    }

    if (event.createdAt instanceof Date) {
      payload['createdAt'] = Timestamp.fromDate(event.createdAt);
    }

    if (event.updatedAt instanceof Date) {
      payload['updatedAt'] = Timestamp.fromDate(event.updatedAt);
    }

    payload['childId'] = event.childId ?? null;

    return payload;
  }

  private serializeSchedule(schedule: CustodySchedule): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      ...schedule,
      startDate: Timestamp.fromDate(new Date(schedule.startDate)),
      endDate: schedule.endDate ? Timestamp.fromDate(new Date(schedule.endDate)) : null,
      biweeklyAltParent1Days: schedule.biweeklyAltParent1Days ?? [],
      biweeklyAltParent2Days: schedule.biweeklyAltParent2Days ?? []
    };

    if (schedule.pendingApproval) {
      payload['pendingApproval'] = {
        ...schedule.pendingApproval,
        startDate: Timestamp.fromDate(new Date(schedule.pendingApproval.startDate)),
        requestedAt: Timestamp.fromDate(new Date(schedule.pendingApproval.requestedAt))
      };
    } else {
      payload['pendingApproval'] = null;
    }

    return payload;
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
