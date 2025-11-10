import { Component, Input, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarEvent, EventType } from '../../core/models/calendar-event.model';

@Component({
  standalone: true,
  selector: 'app-event-form',
  templateUrl: './event-form.component.html',
  styleUrls: ['./event-form.component.scss'],
  imports: [IonicModule, CommonModule, ReactiveFormsModule]
})
export class EventFormComponent implements OnInit {
  @Input() event?: CalendarEvent;
  @Input() selectedDate?: Date;
  
  eventForm!: FormGroup;
  isEditMode = false;
  
  eventTypes = [
    { value: EventType.CUSTODY, label: 'משמרת', icon: 'people', color: 'primary' },
    { value: EventType.PICKUP, label: 'איסוף', icon: 'car', color: 'success' },
    { value: EventType.DROPOFF, label: 'החזרה', icon: 'home', color: 'warning' },
    { value: EventType.SCHOOL, label: 'בית ספר', icon: 'school', color: 'tertiary' },
    { value: EventType.ACTIVITY, label: 'פעילות', icon: 'football', color: 'secondary' },
    { value: EventType.MEDICAL, label: 'רפואי', icon: 'medical', color: 'danger' },
    { value: EventType.HOLIDAY, label: 'חג', icon: 'gift', color: 'warning' },
    { value: EventType.VACATION, label: 'חופשה', icon: 'airplane', color: 'tertiary' },
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
    private calendarService: CalendarService
  ) {}

  ngOnInit() {
    this.isEditMode = !!this.event;
    this.initForm();
    
    if (this.event) {
      this.loadEventData();
    } else if (this.selectedDate) {
      this.setDefaultDate();
    }
  }

  initForm() {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    
    this.eventForm = this.formBuilder.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      type: [EventType.OTHER, Validators.required],
      parentId: ['both', Validators.required],
      startDate: [now.toISOString(), Validators.required],
      startTime: [now.toTimeString().slice(0, 5)],
      endDate: [now.toISOString()],
      endTime: [oneHourLater.toTimeString().slice(0, 5)],
      isAllDay: [false],
      location: [''],
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
      startDate: new Date(this.event.startDate).toISOString(),
      startTime: new Date(this.event.startDate).toTimeString().slice(0, 5),
      endDate: new Date(this.event.endDate).toISOString(),
      endTime: new Date(this.event.endDate).toTimeString().slice(0, 5),
      isAllDay: this.event.isAllDay || false,
      location: this.event.location || '',
      reminderMinutes: this.event.reminderMinutes || 15,
      color: this.event.color || '#2196F3'
    });
  }

  setDefaultDate() {
    if (!this.selectedDate) return;
    
    this.eventForm.patchValue({
      startDate: this.selectedDate.toISOString(),
      endDate: this.selectedDate.toISOString()
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
    
    // צור תאריכים מלאים
    const startDateTime = this.combineDateTime(formValue.startDate, formValue.startTime, formValue.isAllDay);
    const endDateTime = this.combineDateTime(formValue.endDate, formValue.endTime, formValue.isAllDay);

    const eventData: Omit<CalendarEvent, 'id'> = {
      title: formValue.title,
      description: formValue.description,
      type: formValue.type,
      parentId: formValue.parentId,
      startDate: startDateTime,
      endDate: endDateTime,
      isAllDay: formValue.isAllDay,
      location: formValue.location,
      reminderMinutes: formValue.reminderMinutes,
      color: formValue.color
    };

    try {
      if (this.isEditMode && this.event) {
        await this.calendarService.updateEvent(this.event.id, eventData);
      } else {
        await this.calendarService.addEvent(eventData);
      }

      await this.modalController.dismiss({ saved: true });
    } catch (error) {
      console.error('Failed to save calendar event', error);
    }
  }

  combineDateTime(dateStr: string, timeStr: string, isAllDay: boolean): Date {
    const date = new Date(dateStr);
    
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
      await this.modalController.dismiss({ deleted: true });
    } catch (error) {
      console.error('Failed to delete calendar event', error);
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
}
