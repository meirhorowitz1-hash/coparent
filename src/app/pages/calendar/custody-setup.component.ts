import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalController, LoadingController } from '@ionic/angular';
import { CalendarService } from '../../core/services/calendar.service';
import { CustodySchedule, CustodyPattern, CustodyTemplate, CUSTODY_TEMPLATES } from '../../core/models/custody-schedule.model';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-custody-setup',
  templateUrl: './custody-setup.component.html',
  styleUrls: ['./custody-setup.component.scss'],
  standalone: false
})
export class CustodySetupComponent implements OnInit, OnDestroy {
  templates = CUSTODY_TEMPLATES;
  selectedTemplate: CustodyTemplate | null = null;
  
  custodySchedule: CustodySchedule = {
    id: '',
    name: '',
    pattern: CustodyPattern.WEEKLY,
    startDate: new Date(),
    parent1Days: [],
    parent2Days: [],
    isActive: true
  };

  weekDays = [
    { value: 0, label: 'ראשון', short: 'א' },
    { value: 1, label: 'שני', short: 'ב' },
    { value: 2, label: 'שלישי', short: 'ג' },
    { value: 3, label: 'רביעי', short: 'ד' },
    { value: 4, label: 'חמישי', short: 'ה' },
    { value: 5, label: 'שישי', short: 'ו' },
    { value: 6, label: 'שבת', short: 'ש' }
  ];

  step: 'template' | 'customize' | 'confirm' = 'template';
  private destroy$ = new Subject<void>();
  private isProcessing = false;

  constructor(
    private modalController: ModalController,
    private calendarService: CalendarService,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.calendarService.custodySchedule$
      .pipe(takeUntil(this.destroy$))
      .subscribe(schedule => {
 
        if (schedule) {
         
          this.custodySchedule = {
            ...schedule,
            parent1Days: [...schedule.parent1Days],
            parent2Days: [...schedule.parent2Days]
          };
          this.step = 'customize';
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectTemplate(template: CustodyTemplate) {
    this.selectedTemplate = template;
    this.custodySchedule.pattern = template.pattern;
    this.custodySchedule.name = template.nameHebrew;
    
    if (template.id !== 'custom') {
      this.custodySchedule.parent1Days = [...template.parent1Days];
      this.custodySchedule.parent2Days = [...template.parent2Days];
      this.step = 'confirm';
    } else {
      this.step = 'customize';
    }
  }

  toggleDay(parent: 'parent1' | 'parent2', day: number) {
    const days = parent === 'parent1' ? this.custodySchedule.parent1Days : this.custodySchedule.parent2Days;
    const index = days.indexOf(day);
    
    if (index > -1) {
      days.splice(index, 1);
    } else {
      days.push(day);
      // הסר מההורה השני
      const otherParent = parent === 'parent1' ? 'parent2' : 'parent1';
      const otherDays = otherParent === 'parent1' ? this.custodySchedule.parent1Days : this.custodySchedule.parent2Days;
      const otherIndex = otherDays.indexOf(day);
      if (otherIndex > -1) {
        otherDays.splice(otherIndex, 1);
      }
    }
  }

  isDaySelected(parent: 'parent1' | 'parent2', day: number): boolean {
    const days = parent === 'parent1' ? this.custodySchedule.parent1Days : this.custodySchedule.parent2Days;
    return days.includes(day);
  }

  goToCustomize() {
    this.step = 'customize';
  }

  goToConfirm() {
    if (this.custodySchedule.parent1Days.length === 0 && this.custodySchedule.parent2Days.length === 0) {
      return;
    }
    this.step = 'confirm';
  }

  async save() {
    if (this.isProcessing) {
      return;
    }

    this.custodySchedule.id = this.custodySchedule.id || `schedule_${Date.now()}`;

    this.isProcessing = true;
    const loader = await this.presentProgressLoader('מעדכן את המשמרות...');

    const savePromise = this.calendarService.saveCustodySchedule(this.custodySchedule)
      .catch(error => console.error('Failed to save custody schedule', error))
      .finally(() => {
        loader.dismiss();
        this.isProcessing = false;
      });

    await this.modalController.dismiss({ saved: true });
    savePromise.finally(() => void 0);
  }

  async cancel() {
    await this.modalController.dismiss({ saved: false });
  }

  async deleteSchedule() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const loader = await this.presentProgressLoader('מוחק משמרות...');

    const deletePromise = this.calendarService.deleteCustodySchedule()
      .catch(error => console.error('Failed to delete custody schedule', error))
      .finally(() => {
        loader.dismiss();
        this.isProcessing = false;
      });

    await this.modalController.dismiss({ deleted: true });
    deletePromise.finally(() => void 0);
  }

  private async presentProgressLoader(message: string) {
    const loader = await this.loadingController.create({
      message,
      spinner: 'crescent',
      backdropDismiss: false,
      translucent: true,
      cssClass: 'progress-loader'
    });
    await loader.present();
    return loader;
  }
}
