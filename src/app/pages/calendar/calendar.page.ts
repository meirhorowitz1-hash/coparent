import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarDay, CalendarEvent, EventType } from '../../core/models/calendar-event.model';
import { CustodySetupComponent } from './custody-setup.component';
import { EventFormComponent } from './event-form.component';

@Component({
  standalone: true,
  selector: 'app-calendar',
  templateUrl: './calendar.page.html',
  styleUrls: ['./calendar.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule]
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

  constructor(
    private calendarService: CalendarService,
    private modalController: ModalController
  ) {}

  ngOnInit() {
    // האזן לשינויים בחודש הנוכחי
    this.calendarService.currentMonth$
      .pipe(takeUntil(this.destroy$))
      .subscribe(date => {
        this.currentMonth = date;
        this.updateCalendar();
      });

    // האזן לשינויים באירועים
    this.calendarService.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateCalendar();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  updateCalendar() {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    
    console.log('Updating calendar for:', year, month, this.getHebrewMonthName(month));
    this.calendarDays = this.calendarService.generateCalendarDays(year, month);
    this.monthName = this.getHebrewMonthName(month);
    this.yearNumber = year;
    console.log('Calendar days generated:', this.calendarDays.length);
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

  clearAllData() {
    // פונקציה זמנית לניקוי נתונים
    localStorage.clear();
    window.location.reload();
  }

  deleteEvent(eventId: string) {
    this.calendarService.deleteEvent(eventId);
  }
}
