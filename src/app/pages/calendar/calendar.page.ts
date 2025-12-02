import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarDay, CalendarEvent, EventType } from '../../core/models/calendar-event.model';
import { CustodySetupComponent } from './custody-setup.component';
import { EventFormComponent } from './event-form.component';
import { SwapRequestModalComponent } from '../../components/swap-request-modal/swap-request-modal.component';
import { SwapRequestService } from '../../core/services/swap-request.service';

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.page.html',
  styleUrls: ['./calendar.page.scss'],
  standalone: false
})
export class CalendarPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
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

  constructor(
    private calendarService: CalendarService,
    private modalController: ModalController,
    private toastCtrl: ToastController,
    private swapRequestService: SwapRequestService
  ) {}

  ngOnInit() {
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
}
