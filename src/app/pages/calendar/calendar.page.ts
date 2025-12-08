import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent, ModalController, ToastController } from '@ionic/angular';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { addIcons } from 'ionicons';
import {
  medkitOutline,
  schoolOutline,
  footballOutline,
  cartOutline,
  homeOutline,
  documentTextOutline,
  ellipsisHorizontalOutline,
  checkboxOutline,
  arrowForwardOutline,
  addOutline
} from 'ionicons/icons';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarDay, CalendarEvent, EventType } from '../../core/models/calendar-event.model';
import { CustodySetupComponent } from './custody-setup.component';
import { EventFormComponent } from './event-form.component';
import { SwapRequestModalComponent } from '../../components/swap-request-modal/swap-request-modal.component';
import { TaskFormModalComponent } from '../../components/task-form-modal/task-form-modal.component';
import { SwapRequestService } from '../../core/services/swap-request.service';
import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { Task, TaskStatus, TaskCategory } from '../../core/models/task.model';
import { I18nService } from '../../core/services/i18n.service';

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
  parentLabels = { parent1: '', parent2: '' };
  hasPendingCustodyApproval = false;
  currentUserId: string | null = null;
  currentUserRole: 'parent1' | 'parent2' | null = null;
  swapRequests: SwapRequest[] = [];
  requestNotes: Record<string, string> = {};
  children: string[] = [];
  
  // Tasks
  tasks: Task[] = [];
  openTasks: Task[] = [];
  tasksWithDueDate: Task[] = [];
  readonly TaskStatus = TaskStatus;
  private taskCompletionTimers = new Map<string, any>();
  
  protected readonly SwapRequestStatus = SwapRequestStatus;
  private viewReady = false;
  private hasScrolledToSwap = false;
  private seenEventIds = new Set<string>();
  private newEventIds = new Set<string>();
  private readonly SEEN_STORAGE_KEY = 'calendar:seen-events';
  private pendingEventId: string | null = null;
  private langSub?: Subscription;

  constructor(
    private calendarService: CalendarService,
    private modalController: ModalController,
    private toastCtrl: ToastController,
    private swapRequestService: SwapRequestService,
    private taskHistoryService: TaskHistoryService,
    private route: ActivatedRoute,
    private i18n: I18nService
  ) {
    addIcons({
      medkitOutline,
      schoolOutline,
      footballOutline,
      cartOutline,
      homeOutline,
      documentTextOutline,
      ellipsisHorizontalOutline,
      checkboxOutline,
      arrowForwardOutline,
      addOutline
    });
  }

  ngOnInit() {
    this.loadSeenEvents();
    this.parentLabels = {
      parent1: this.i18n.translate('profile.parent1'),
      parent2: this.i18n.translate('profile.parent2')
    };
    this.buildWeekDays();
    this.langSub = this.i18n.language$.subscribe(() => {
      this.buildWeekDays();
      this.updateCalendar();
    });

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
        this.focusEventFromQuery();
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
          parent1: metadata.parent1.name || this.i18n.translate('profile.parent1'),
          parent2: metadata.parent2.name || this.i18n.translate('profile.parent2')
        };
      });

    this.calendarService.familyChildren$
      .pipe(takeUntil(this.destroy$))
      .subscribe(children => {
        this.children = children ?? [];
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

    // Subscribe to tasks
    this.taskHistoryService.tasks$
      .pipe(takeUntil(this.destroy$))
      .subscribe(tasks => {
        this.tasks = tasks;
        this.openTasks = tasks
          .filter(t => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED)
          .sort((a, b) => {
            // Sort by due date (no date = last)
            const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            return aTime - bTime;
          });
        this.tasksWithDueDate = this.openTasks.filter(t => t.dueDate);
        this.updateCalendar();
      });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const eventId = params['eventId'];
      this.pendingEventId = typeof eventId === 'string' ? eventId : null;
      if (this.pendingEventId) {
        this.focusEventFromQuery();
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
    this.langSub?.unsubscribe();
  }

  updateCalendar() {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    
    this.calendarDays = this.calendarService.generateCalendarDays(year, month);
    this.monthName = this.i18n.formatDate(new Date(year, month, 1), { month: 'long' });
    this.yearNumber = year;
    this.buildWeekDays();
  }
  private isSameDay(dateA: Date, dateB: Date): boolean {
    return (
      dateA.getFullYear() === dateB.getFullYear() &&
      dateA.getMonth() === dateB.getMonth() &&
      dateA.getDate() === dateB.getDate()
    );
  }

  private focusEventFromQuery() {
    if (!this.pendingEventId) {
      return;
    }

    const targetEvent = this.calendarService.getEventById(this.pendingEventId);
    if (!targetEvent) {
      return;
    }

    const eventDate = new Date(targetEvent.startDate);
    if (isNaN(eventDate.getTime())) {
      this.pendingEventId = null;
      return;
    }

    this.calendarService.setMonth(eventDate);
    this.currentMonth = new Date(eventDate.getFullYear(), eventDate.getMonth(), 1);
    this.updateCalendar();

    const day = this.calendarDays.find(d => this.isSameDay(d.date, eventDate));
    if (day) {
      this.onDayClick(day);
      this.pendingEventId = null;
    }
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
      [EventType.CUSTODY]: 'calendar.eventType.custody',
      [EventType.PICKUP]: 'calendar.eventType.pickup',
      [EventType.DROPOFF]: 'calendar.eventType.dropoff',
      [EventType.SCHOOL]: 'calendar.eventType.school',
      [EventType.ACTIVITY]: 'calendar.eventType.activity',
      [EventType.MEDICAL]: 'calendar.eventType.medical',
      [EventType.HOLIDAY]: 'calendar.eventType.holiday',
      [EventType.VACATION]: 'calendar.eventType.vacation',
      [EventType.OTHER]: 'calendar.eventType.other'
    };
    return this.i18n.translate(labels[type] || 'calendar.eventType.other');
  }

  formatTime(date: Date): string {
    return this.i18n.formatTime(date);
  }

  getChildLabel(childId?: string | null): string {
    if (!childId) {
      return '';
    }
    const found = this.children.find(c => c === childId);
    return found || childId;
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
      this.presentToast(this.i18n.translate('calendar.toast.selectDay'), 'danger');
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
      await this.presentToast(this.i18n.translate('calendar.toast.swapOnlyOwn'), 'danger');
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
        await this.presentToast(this.i18n.translate('calendar.toast.swapSent'), 'success');
      } catch (error: any) {
        console.error('Failed to submit swap request', error);
        await this.presentToast(this.i18n.translate('calendar.toast.swapFailed'), 'danger');
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
      await this.presentToast(this.i18n.translate('calendar.toast.deleteFailed'), 'danger');
      return;
    }

    await this.presentToast(this.i18n.translate('calendar.toast.deleted'), 'success');
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
    return request.requestType === 'one-way'
      ? this.i18n.translate('calendar.request.type.oneWay')
      : this.i18n.translate('calendar.request.type.swap');
  }

  formatDate(date: Date | string | number): string {
    return this.i18n.formatDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  formatFullDate(date: Date): string {
    return this.i18n.formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
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
      const statusLabel =
        status === SwapRequestStatus.APPROVED
          ? this.i18n.translate('calendar.request.status.approved')
          : status === SwapRequestStatus.REJECTED
            ? this.i18n.translate('calendar.request.status.rejected')
            : this.i18n.translate('calendar.request.status.cancelled');
      await this.presentToast(statusLabel);
    } catch (error) {
      console.error('Failed to update swap request', error);
      await this.presentToast(this.i18n.translate('calendar.request.status.failed'), 'danger');
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

  private buildWeekDays() {
    this.weekDays = [
      this.i18n.translate('calendar.weekdays.sun'),
      this.i18n.translate('calendar.weekdays.mon'),
      this.i18n.translate('calendar.weekdays.tue'),
      this.i18n.translate('calendar.weekdays.wed'),
      this.i18n.translate('calendar.weekdays.thu'),
      this.i18n.translate('calendar.weekdays.fri'),
      this.i18n.translate('calendar.weekdays.sat')
    ];
  }

  // ===== Tasks =====

  getTasksForDay(day: CalendarDay): Task[] {
    return this.tasksWithDueDate.filter(task => {
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return this.isSameDay(dueDate, day.date);
    });
  }

  hasTasksOnDay(day: CalendarDay): boolean {
    return this.getTasksForDay(day).length > 0;
  }

  formatTaskDueDate(date: Date | string | null | undefined): string {
    if (!date) return this.i18n.translate('tasks.noDueDate');
    const d = new Date(date);
    if (isNaN(d.getTime())) return this.i18n.translate('tasks.noDueDate');
    
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (this.isSameDay(d, today)) {
      return this.i18n.translate('calendar.tasks.today');
    }
    if (this.isSameDay(d, tomorrow)) {
      return this.i18n.translate('calendar.tasks.tomorrow');
    }
    
    return this.i18n.formatDate(d, { day: '2-digit', month: 'short' });
  }

  isTaskOverdue(task: Task): boolean {
    if (!task.dueDate) return false;
    const dueDate = new Date(task.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  }

  async toggleTaskCompletion(task: Task, event: Event): Promise<void> {
    event.stopPropagation();
    
    // אם יש טיימר קיים - בטל אותו
    const existingTimer = this.taskCompletionTimers.get(task.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.taskCompletionTimers.delete(task.id);
    }

    const checkbox = (event.target as any);
    const isChecked = checkbox?.checked ?? false;

    if (isChecked) {
      // סימון כהושלם - המתן 3 שניות לפני עדכון
      const timer = setTimeout(async () => {
        this.taskCompletionTimers.delete(task.id);
        try {
          await this.taskHistoryService.updateStatus(task.id, TaskStatus.COMPLETED);
        } catch (error) {
          console.error('Failed to update task status', error);
          await this.presentToast(this.i18n.translate('tasks.toast.updateFailed'), 'danger');
        }
      }, 3000);
      this.taskCompletionTimers.set(task.id, timer);
    } else {
      // ביטול סימון - עדכן מיד
      try {
        await this.taskHistoryService.updateStatus(task.id, TaskStatus.PENDING);
      } catch (error) {
        console.error('Failed to update task status', error);
        await this.presentToast(this.i18n.translate('tasks.toast.updateFailed'), 'danger');
      }
    }
  }

  getTaskCategoryIcon(category?: TaskCategory): string {
    const icons: Record<TaskCategory, string> = {
      [TaskCategory.MEDICAL]: 'medkit-outline',
      [TaskCategory.EDUCATION]: 'school-outline',
      [TaskCategory.ACTIVITY]: 'football-outline',
      [TaskCategory.SHOPPING]: 'cart-outline',
      [TaskCategory.HOUSEHOLD]: 'home-outline',
      [TaskCategory.PAPERWORK]: 'document-text-outline',
      [TaskCategory.OTHER]: 'ellipsis-horizontal-outline'
    };
    return icons[category || TaskCategory.OTHER] || 'checkbox-outline';
  }

  async openAddTaskModal(): Promise<void> {
    const modal = await this.modalController.create({
      component: TaskFormModalComponent
    });

    await modal.present();
  }
}
