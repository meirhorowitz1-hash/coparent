import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarEvent, EventType } from '../../core/models/calendar-event.model';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-event-form',
  templateUrl: './event-form.component.html',
  styleUrls: ['./event-form.component.scss'],
  standalone: false
})
export class EventFormComponent implements OnInit, OnDestroy {
  @Input() event?: CalendarEvent;
  @Input() selectedDate?: Date;
  
  eventForm!: FormGroup;
  isEditMode = false;
  parentLabels = { parent1: 'הורה 1', parent2: 'הורה 2' };
  private destroy$ = new Subject<void>();
  
  eventTypes = [
    { value: EventType.CUSTODY, label: 'משמרת', icon: 'people', color: 'primary' },
    { value: EventType.ACTIVITY, label: 'פעילות', icon: 'football', color: 'secondary' },
    { value: EventType.MEDICAL, label: 'רפואי', icon: 'medical', color: 'danger' },
    { value: EventType.OTHER, label: 'אחר', icon: 'ellipsis-horizontal', color: 'medium' }
  ];

  parentOptions = [
    { value: 'parent1', label: 'הורה 1', color: '#4CAF50' },
    { value: 'parent2', label: 'הורה 2', color: '#2196F3' },
    { value: 'both', label: 'שניהם', color: '#FF9800' }
  ];

  reminderOptions = [
    { value: 0, label: 'בזמן האירוע' },
    { value: 15, label: '15 דקות לפני' },
    { value: 30, label: '30 דקות לפני' },
    { value: 60, label: 'שעה לפני' },
    { value: 1440, label: 'יום לפני' },
    { value: 10080, label: 'שבוע לפני' }
  ];

  constructor(
    private modalController: ModalController,
    private formBuilder: FormBuilder,
    private calendarService: CalendarService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentLabels = {
          parent1: metadata.parent1.name || 'הורה 1',
          parent2: metadata.parent2.name || 'הורה 2'
        };
        this.refreshParentOptions();
      });

    this.isEditMode = !!this.event;
    this.initForm();
    if (this.event) {
      this.loadEventData();
    }
  }

  private refreshParentOptions() {
    this.parentOptions = this.parentOptions.map(option => {
      if (option.value === 'parent1') {
        return { ...option, label: this.parentLabels.parent1 };
      }
      if (option.value === 'parent2') {
        return { ...option, label: this.parentLabels.parent2 };
      }
      return option;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
 

  initForm() {
    const baseDate = this.selectedDate ? new Date(this.selectedDate) : new Date();
    baseDate.setSeconds(0, 0);
    const now = baseDate;
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    
    this.eventForm = this.formBuilder.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      type: [EventType.OTHER, Validators.required],
      parentId: ['both', Validators.required],
      startTime: [now.toTimeString().slice(0, 5)],
      endTime: [oneHourLater.toTimeString().slice(0, 5)],
      isAllDay: [false],
      location: [''],
      reminderEnabled: [true],
      reminderMinutes: [15],
      color: ['#2196F3']
    });

    // האזן לשינויים ב-isAllDay
    this.eventForm.get('isAllDay')?.valueChanges.subscribe(isAllDay => {
      if (isAllDay) {
        this.eventForm.get('startTime')?.disable();
        this.eventForm.get('endTime')?.disable();
      } else {
        this.eventForm.get('startTime')?.enable();
        this.eventForm.get('endTime')?.enable();
      }
    });

    // האזן לשינויים בסוג האירוע ועדכן צבע
    this.eventForm.get('type')?.valueChanges.subscribe(type => {
      const eventType = this.eventTypes.find(t => t.value === type);
      if (eventType) {
        this.updateColorByType(type);
      }
    });
  }

  loadEventData() {
    if (!this.event) return;
    
    this.eventForm.patchValue({
      title: this.event.title,
      description: this.event.description || '',
      type: this.event.type,
      parentId: this.event.parentId,
      startTime: new Date(this.event.startDate).toTimeString().slice(0, 5),
      endTime: new Date(this.event.endDate).toTimeString().slice(0, 5),
      isAllDay: this.event.isAllDay || false,
      location: this.event.location || '',
      reminderMinutes: this.event.reminderMinutes || 15,
      reminderEnabled: this.event.reminderMinutes !== undefined && this.event.reminderMinutes !== null,
      color: this.event.color || '#2196F3'
    });
  }

  updateColorByType(type: EventType) {
    let color = '#2196F3';
    const parentId = this.eventForm.get('parentId')?.value;
    
    if (type === EventType.CUSTODY) {
      if (parentId === 'parent1') {
        color = '#4CAF50';
      } else if (parentId === 'parent2') {
        color = '#2196F3';
      } else {
        color = '#FF9800';
      }
    } else if (type === EventType.SCHOOL) {
      color = '#FF9800';
    } else if (type === EventType.MEDICAL) {
      color = '#F44336';
    } else if (type === EventType.ACTIVITY) {
      color = '#9C27B0';
    }
    
    this.eventForm.patchValue({ color }, { emitEvent: false });
  }

  getSelectedEventType() {
    const type = this.eventForm.get('type')?.value;
    return this.eventTypes.find(t => t.value === type);
  }

  async save() {
    if (this.eventForm.invalid) {
      Object.keys(this.eventForm.controls).forEach(key => {
        this.eventForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formValue = this.eventForm.getRawValue();
    
    const eventDay = this.getEventDay();
    if (!eventDay) {
      await this.presentToast('בחרו יום בלוח לפני יצירת אירוע', 'danger');
      return;
    }

    // צור תאריכים מלאים (עבור היום שנבחר)
    const startDateTime = this.combineDateTime(eventDay, formValue.startTime, formValue.isAllDay);
    const endDateTime = this.combineDateTime(eventDay, formValue.endTime, formValue.isAllDay);

    const eventData: Omit<CalendarEvent, 'id'> = {
      title: formValue.title,
      description: formValue.description,
      type: formValue.type,
      parentId: formValue.parentId,
      startDate: startDateTime,
      endDate: endDateTime,
      isAllDay: formValue.isAllDay,
      location: formValue.location,
      reminderMinutes: formValue.reminderEnabled ? formValue.reminderMinutes : undefined,
      color: formValue.color
    };

    if (this.hasOverlap(eventData, this.event?.id)) {
      await this.presentToast('יש כבר אירוע חופף להורה הזה', 'danger');
      return;
    }

    try {
      if (this.isEditMode && this.event) {
        await this.calendarService.updateEvent(this.event.id, eventData);
        await this.presentToast('האירוע עודכן', 'success');
      } else {
        await this.calendarService.addEvent(eventData);
        await this.presentToast('האירוע נוצר', 'success');
      }

      await this.modalController.dismiss({ saved: true });
    } catch (error) {
      console.error('Failed to save calendar event', error);
      await this.presentToast('שמירת האירוע נכשלה, נסו שוב', 'danger');
    }
  }

  combineDateTime(baseDate: Date, timeStr: string, isAllDay: boolean): Date {
    const date = new Date(baseDate);
    if (isAllDay) {
      date.setHours(0, 0, 0, 0);
    } else if (timeStr) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      date.setHours(hours, minutes, 0, 0);
    }
    return date;
  }

  async cancel() {
    await this.modalController.dismiss({ saved: false });
  }

  async deleteEvent() {
    if (!this.event) return;
    
    try {
      await this.calendarService.deleteEvent(this.event.id);
      await this.presentToast('האירוע נמחק', 'success');
      await this.modalController.dismiss({ deleted: true });
    } catch (error) {
      console.error('Failed to delete calendar event', error);
      await this.presentToast('מחיקת האירוע נכשלה', 'danger');
    }
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.eventForm.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.eventForm.get(fieldName);
    
    if (field?.hasError('required')) {
      return 'שדה חובה';
    }
    
    if (field?.hasError('minlength')) {
      const minLength = field.getError('minlength').requiredLength;
      return `נדרש לפחות ${minLength} תווים`;
    }
    
    return '';
  }

  private hasOverlap(eventData: Omit<CalendarEvent, 'id'>, currentId?: string): boolean {
    // בודק אם יש אירוע אחר עם חפיפה בזמן לאותו הורה
    const dayEvents = this.calendarService.getEventsForDay(eventData.startDate);

    const currentStart = new Date(eventData.startDate).getTime();
    const currentEnd = new Date(eventData.endDate).getTime();

    const isSameParent = (a: 'parent1' | 'parent2' | 'both', b: 'parent1' | 'parent2' | 'both') =>
      a === 'both' || b === 'both' || a === b;

    return dayEvents.some(existing => {
      if (existing.id === currentId) {
        return false;
      }
      if (!isSameParent(eventData.parentId, existing.parentId)) {
        return false;
      }

      const existingStart = new Date(existing.startDate).getTime();
      const existingEnd = new Date(existing.endDate).getTime();

      return currentStart <= existingEnd && existingStart <= currentEnd;
    });
  }

  private async presentToast(message: string, color: 'success' | 'danger' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  getEventDay(): Date | null {
    if (this.event) {
      const date = new Date(this.event.startDate);
      date.setHours(0, 0, 0, 0);
      return date;
    }

    if (this.selectedDate) {
      const date = new Date(this.selectedDate);
      date.setHours(0, 0, 0, 0);
      return date;
    }

    return null;
  }
}
