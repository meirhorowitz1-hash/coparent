import { TestBed } from '@angular/core/testing';
import { IonicModule, ToastController } from '@ionic/angular';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { EventFormComponent } from './event-form.component';
import { CalendarService } from '../../core/services/calendar.service';
import { EventType } from '../../core/models/calendar-event.model';

describe('EventFormComponent', () => {
  const toastSpy = jasmine.createSpy('present');
  const toastControllerMock = {
    create: jasmine.createSpy('create').and.callFake(() =>
      Promise.resolve({
        present: toastSpy
      })
    )
  };

  const baseEvent = {
    id: 'existing',
    title: 'אירוע קיים',
    description: '',
    startDate: new Date('2025-12-01T12:00:00Z'),
    endDate: new Date('2025-12-01T13:00:00Z'),
    type: EventType.OTHER,
    parentId: 'parent1' as const,
    isAllDay: false
  };

  const setup = (mockEvents: typeof baseEvent[] = []) => {
    const calendarServiceMock = {
      getEventsForDay: jasmine.createSpy('getEventsForDay').and.returnValue(mockEvents),
      addEvent: jasmine.createSpy('addEvent').and.returnValue(Promise.resolve()),
      updateEvent: jasmine.createSpy('updateEvent').and.returnValue(Promise.resolve())
    };

    TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), FormsModule, ReactiveFormsModule],
      declarations: [EventFormComponent],
      providers: [
        { provide: CalendarService, useValue: calendarServiceMock },
        { provide: ToastController, useValue: toastControllerMock }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(EventFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { component, calendarServiceMock };
  };

  const fillForm = (component: EventFormComponent, overrides?: Partial<Record<string, any>>) => {
    const now = new Date('2025-12-01T12:00:00Z');
    const later = new Date('2025-12-01T13:00:00Z');
    component.selectedDate = now;
    component.eventForm.patchValue({
      title: 'בדיקה',
      description: '',
      type: EventType.OTHER,
      parentId: 'parent1',
      startTime: '12:00',
      endTime: '13:00',
      isAllDay: false,
      location: '',
      reminderEnabled: true,
      reminderMinutes: 15,
      color: '#123456',
      ...overrides
    });
  };

  it('blocks saving when overlapping event exists for same parent', async () => {
    const { component, calendarServiceMock } = setup([baseEvent]);
    fillForm(component);

    await component.save();

    expect(calendarServiceMock.addEvent).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalled();
  });

  it('saves when no overlap', async () => {
    const { component, calendarServiceMock } = setup([]);
    fillForm(component);

    await component.save();

    expect(calendarServiceMock.addEvent).toHaveBeenCalled();
  });

  it('disables reminder when toggle off', async () => {
    const { component, calendarServiceMock } = setup([]);
    fillForm(component, { reminderEnabled: false });

    await component.save();

    const call = calendarServiceMock.addEvent.calls.mostRecent();
    expect(call.args[0].reminderMinutes).toBeNull();
  });
});
