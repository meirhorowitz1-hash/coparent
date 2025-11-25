import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarDay, CalendarEvent, EventType } from '../../core/models/calendar-event.model';
import { CustodySetupComponent } from './custody-setup.component';
import { EventFormComponent } from './event-form.component';

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

  constructor(
    private calendarService: CalendarService,
    private modalController: ModalController
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
    this.openEventForm();
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
    } catch (error) {
      console.error('Failed to delete event', error);
    }
  }
}
