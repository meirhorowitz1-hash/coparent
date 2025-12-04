import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IonContent, ModalController, ToastController } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarDay, CalendarEvent, EventType } from '../../core/models/calendar-event.model';
import { CustodySetupComponent } from './custody-setup.component';
import { EventFormComponent } from './event-form.component';
import { SwapRequestModalComponent } from '../../components/swap-request-modal/swap-request-modal.component';
import { SwapRequestService } from '../../core/services/swap-request.service';
import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';
import { TaskHistoryService } from '../../core/services/task-history.service';

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.page.html',
  styleUrls: ['./calendar.page.scss'],
  standalone: false
})
export class CalendarPage implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();
  @ViewChild(IonContent) private ionContent?: IonContent;
  @ViewChild('swapPanel') private swapPanel?: ElementRef<HTMLElement>;
  
  calendarDays: CalendarDay[] = [];
  currentMonth: Date = new Date();
  monthName: string = '';
  yearNumber: number = 0;
  weekDays = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  selectedDay: CalendarDay | null = null;
  showEventModal = false;
  parentLabels = { parent1: 'הורה 1', parent2: 'הורה 2' };
  hasPendingCustodyApproval = false;
  currentUserId: string | null = null;
  currentUserRole: 'parent1' | 'parent2' | null = null;
  swapRequests: SwapRequest[] = [];
  requestNotes: Record<string, string> = {};
  protected readonly SwapRequestStatus = SwapRequestStatus;
  private viewReady = false;
  private hasScrolledToSwap = false;
  private seenEventIds = new Set<string>();
  private newEventIds = new Set<string>();
  private readonly SEEN_STORAGE_KEY = 'calendar:seen-events';

  constructor(
    private calendarService: CalendarService,
    private modalController: ModalController,
    private toastCtrl: ToastController,
    private swapRequestService: SwapRequestService,
    private taskHistoryService: TaskHistoryService
  ) {}

  ngOnInit() {
    this.loadSeenEvents();

    // האזן לשינויים בחודש הנוכחי
    this.calendarService.currentMonth$
      .pipe(takeUntil(this.destroy$))
      .subscribe(date => {
        console.log('[CalendarPage] currentMonth$ emitted', date);
        this.currentMonth = date;
        this.updateCalendar();
      });

    // האזן לשינויים באירועים
    this.calendarService.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(events => {
        console.log('[CalendarPage] events$ received', events, 'events');
        this.updateCalendar();
        this.updateNewEvents(events);
      });

    // האזן לשינויים במשמורת (כדי לרענן צבעי ימים)
    this.calendarService.custodySchedule$
      .pipe(takeUntil(this.destroy$))
      .subscribe(schedule => {
        console.log('[CalendarPage] custodySchedule$ updated', schedule);
        const currentUid = this.calendarService.getCurrentUserId();
        this.hasPendingCustodyApproval = !!(
          schedule?.pendingApproval &&
          currentUid &&
          schedule.pendingApproval.requestedBy !== currentUid
        );
        this.currentUserId = currentUid;
        this.currentUserRole = this.calendarService.getParentRoleForUser(currentUid);
        this.updateCalendar();
      });

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentLabels = {
          parent1: metadata.parent1.name || 'הורה 1',
          parent2: metadata.parent2.name || 'הורה 2'
        };
      });

    this.swapRequestService.swapRequests$
      .pipe(takeUntil(this.destroy$))
      .subscribe(requests => {
        this.swapRequests = requests;
        if (this.pendingSwapRequests.length === 0) {
          this.hasScrolledToSwap = false;
        } else {
          this.scheduleSwapScroll();
        }
      });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.scheduleSwapScroll();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  updateCalendar() {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    
    this.calendarDays = this.calendarService.generateCalendarDays(year, month);
    this.monthName = this.getHebrewMonthName(month);
    this.yearNumber = year;
  }

  getHebrewMonthName(month: number): string {
    const months = [
      'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
    ];
    return months[month];
  }

  previousMonth() {
 
    this.calendarService.previousMonth();
  }

  nextMonth() {

    this.calendarService.nextMonth();
  }

  goToCurrentMonth() {
    this.calendarService.setMonth(new Date());
  }

  onDayClick(day: CalendarDay) {
    this.selectedDay = day;
    this.markDayEventsSeen(day);
    this.persistSeenEvents();
    this.showEventModal = true;
  }

  closeModal() {
    this.showEventModal = false;
    this.selectedDay = null;
  }

  getDayClasses(day: CalendarDay): string {
    const classes = ['calendar-day'];
    
    if (!day.isCurrentMonth) {
      classes.push('other-month');
    }
    
    if (day.isToday) {
      classes.push('today');
    }
    
    if (day.primaryParent === 'parent1') {
      classes.push('parent1-day');
    } else if (day.primaryParent === 'parent2') {
      classes.push('parent2-day');
    }
    
    if (day.events.length > 0) {
      classes.push('has-events');
    }
    
    return classes.join(' ');
  }

  getEventTypeLabel(type: EventType): string {
    const labels: Record<EventType, string> = {
      [EventType.CUSTODY]: 'משמרת',
      [EventType.PICKUP]: 'איסוף',
      [EventType.DROPOFF]: 'החזרה',
      [EventType.SCHOOL]: 'בית ספר',
      [EventType.ACTIVITY]: 'פעילות',
      [EventType.MEDICAL]: 'רפואי',
      [EventType.HOLIDAY]: 'חג',
      [EventType.VACATION]: 'חופשה',
      [EventType.OTHER]: 'אחר'
    };
    return labels[type] || 'אחר';
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('he-IL', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  showTemplateParent(day: CalendarDay): 'parent1' | 'parent2' | null {
    if (!day.primaryParent) {
      return null;
    }

    const hasCustodyEvent = day.events.some(event => event.type === EventType.CUSTODY);
    return hasCustodyEvent ? null : day.primaryParent;
  }

  addNewEvent() {
    if (!this.selectedDay) {
      this.presentToast('בחרו יום בלוח כדי להוסיף אירוע', 'danger');
      return;
    }
    this.openEventForm(undefined, this.selectedDay.date);
  }

  canRequestSwap(day: CalendarDay | null): boolean {
    if (!day || !day.primaryParent) {
      return false;
    }
    const role =
      this.currentUserRole ||
      this.calendarService.getParentRoleForUser(this.calendarService.getCurrentUserId());
    if (!role) {
      return false;
    }
    return day.primaryParent === role;
  }

  isSwapOverride(event: CalendarEvent): boolean {
    return !!event.swapRequestId;
  }

  async requestSwapForSelectedDay() {
    if (!this.selectedDay) {
      return;
    }
    if (!this.canRequestSwap(this.selectedDay)) {
      await this.presentToast('אפשר לבקש החלפה רק ביום שבו הילדים אצלך', 'danger');
      return;
    }

    const lockedDate = new Date(this.selectedDay.date);
    lockedDate.setHours(12, 0, 0, 0); // set to midday to avoid TZ shifting the date

    const modal = await this.modalController.create({
      component: SwapRequestModalComponent,
      componentProps: {
        initialOriginalDate: lockedDate.toISOString(),
        lockOriginalDate: true
      }
    });

    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'confirm' && data) {
      try {
        await this.swapRequestService.createSwapRequest({
          originalDate: data.originalDate,
          proposedDate: data.proposedDate,
          reason: data.reason,
          requestType: data.requestType
        });
        await this.presentToast('בקשת ההחלפה נשלחה', 'success');
      } catch (error: any) {
        console.error('Failed to submit swap request', error);
        await this.presentToast('לא ניתן לשלוח בקשה ליום הזה', 'danger');
      }
    }
  }

  async openEventForm(event?: CalendarEvent, selectedDate?: Date) {
    const modal = await this.modalController.create({
      component: EventFormComponent,
      componentProps: {
        event: event,
        selectedDate: selectedDate || this.selectedDay?.date
      }
    });
    
    await modal.present();
    
    const { data } = await modal.onWillDismiss();
    if (data?.saved || data?.deleted) {
      this.updateCalendar();
      if (data?.deleted) {
        this.closeModal();
      }
    }
  }

  async openCustodySetup() {
    const modal = await this.modalController.create({
      component: CustodySetupComponent
    });
    
    await modal.present();
    
    const { data } = await modal.onWillDismiss();
    if (data?.saved || data?.deleted) {
      // רענן את הלוח
      this.updateCalendar();
    }
  }

  async deleteEvent(eventId: string) {
    try {
      await this.calendarService.deleteEvent(eventId);
      // Optimistic UI update so the event disappears immediately
      const normalize = (date: Date) => {
        const copy = new Date(date);
        copy.setHours(0, 0, 0, 0);
        return copy.getTime();
      };

      if (this.selectedDay) {
        this.selectedDay = {
          ...this.selectedDay,
          events: this.selectedDay.events.filter(event => event.id !== eventId)
        };
      }

      this.calendarDays = this.calendarDays.map(day =>
        normalize(day.date) === (this.selectedDay ? normalize(this.selectedDay.date) : NaN)
          ? { ...day, events: day.events.filter(event => event.id !== eventId) }
          : day
      );

      // Refresh to stay in sync with Firestore updates
      this.updateCalendar();
    } catch (error) {
      console.error('Failed to delete event', error);
      await this.presentToast('מחיקת האירוע נכשלה', 'danger');
      return;
    }

    await this.presentToast('האירוע נמחק', 'success');
  }

  private async presentToast(message: string, color: 'success' | 'danger' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  // ===== אירועים חדשים =====
  hasNewEvent(day: CalendarDay): boolean {
    return day.events.some(ev => this.newEventIds.has(ev.id));
  }

  private loadSeenEvents() {
    try {
      const raw = localStorage.getItem(this.SEEN_STORAGE_KEY);
      if (raw) {
        (JSON.parse(raw) as string[]).forEach(id => this.seenEventIds.add(id));
      }
    } catch {
      // ignore
    }
  }

  private persistSeenEvents() {
    try {
      localStorage.setItem(this.SEEN_STORAGE_KEY, JSON.stringify(Array.from(this.seenEventIds)));
    } catch {
      // ignore
    }
  }

  private isEventRelevant(event: CalendarEvent): boolean {
    const uid = this.calendarService.getCurrentUserId();
    const role = this.calendarService.getParentRoleForUser(uid);
    if (!uid) {
      return false;
    }
    // סימון חדש רק אם ברור מי יצר את האירוע וזה לא המשתמש הנוכחי
    if (!event.createdBy || event.createdBy === uid) {
      return false;
    }
    const targetsUid = event.targetUids?.includes(uid);
    const targetsRole =
      event.parentId === 'both' ||
      (role === 'parent1' && event.parentId === 'parent1') ||
      (role === 'parent2' && event.parentId === 'parent2');
    return !!(targetsUid || targetsRole);
  }

  private updateNewEvents(events: CalendarEvent[]) {
    const relevant = events.filter(ev => this.isEventRelevant(ev));
    this.newEventIds = new Set<string>(
      relevant.map(ev => ev.id).filter(id => !this.seenEventIds.has(id))
    );

    if (this.newEventIds.size > 0 && this.viewReady) {
      this.scrollToFirstNewEvent(relevant);
    }
  }

  private markDayEventsSeen(day: CalendarDay) {
    day.events.forEach(ev => {
      this.seenEventIds.add(ev.id);
      this.newEventIds.delete(ev.id);
    });
  }

  private scrollToFirstNewEvent(events: CalendarEvent[]) {
    if (!this.ionContent) {
      return;
    }
    const first = events.find(ev => this.newEventIds.has(ev.id));
    if (!first) {
      return;
    }

    setTimeout(() => {
      const selector = `[data-date="${first.startDate.toISOString().slice(0, 10)}"]`;
      const dayEl = document.querySelector<HTMLElement>(selector);
      if (dayEl) {
        const y = dayEl.getBoundingClientRect().top + window.scrollY - 120;
        this.ionContent!.scrollToPoint(0, y, 400);
      }
    }, 150);
  }

  // בקשות החלפה
  get pendingSwapRequests(): SwapRequest[] {
    return this.swapRequests.filter(request => request.status === SwapRequestStatus.PENDING);
  }

  canRespondToRequest(request: SwapRequest): boolean {
    return (
      request.status === SwapRequestStatus.PENDING &&
      !!this.currentUserId &&
      request.requestedTo === this.currentUserId
    );
  }

  canCancelRequest(request: SwapRequest): boolean {
    return (
      request.status === SwapRequestStatus.PENDING &&
      !!this.currentUserId &&
      request.requestedBy === this.currentUserId
    );
  }

  getRequestTypeLabel(request: SwapRequest): string {
    return request.requestType === 'one-way' ? 'בקשה ללא החזרה' : 'בקשת החלפה';
  }

  formatDate(date: Date | string | number): string {
    return new Date(date).toLocaleDateString('he-IL');
  }

  async handleRequestAction(request: SwapRequest, status: SwapRequestStatus) {
    const canPerform =
      status === SwapRequestStatus.CANCELLED
        ? this.canCancelRequest(request)
        : this.canRespondToRequest(request);

    if (!canPerform) {
      return;
    }

    const note =
      status === SwapRequestStatus.CANCELLED ? undefined : (this.requestNotes[request.id] || '');

    try {
      await this.swapRequestService.updateSwapRequestStatus(request.id, status, note);
      if (status !== SwapRequestStatus.CANCELLED) {
        this.requestNotes = { ...this.requestNotes, [request.id]: '' };
      }
      await this.presentToast(status === SwapRequestStatus.APPROVED ? 'הבקשה אושרה' : status === SwapRequestStatus.REJECTED ? 'הבקשה נדחתה' : 'הבקשה בוטלה');
    } catch (error) {
      console.error('Failed to update swap request', error);
      await this.presentToast('עדכון הבקשה נכשל', 'danger');
    }
  }

  private scheduleSwapScroll() {
    if (!this.viewReady || this.hasScrolledToSwap || !this.pendingSwapRequests.length) {
      return;
    }
    setTimeout(() => {
      if (!this.swapPanel?.nativeElement || !this.ionContent) {
        return;
      }
      const y = this.swapPanel.nativeElement.offsetTop - 24;
      this.ionContent.scrollToPoint(0, y, 500);
      this.hasScrolledToSwap = true;
    }, 100);
  }
}
