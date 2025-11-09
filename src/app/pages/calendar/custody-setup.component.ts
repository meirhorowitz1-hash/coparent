import { Component, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService } from '../../core/services/calendar.service';
import { CustodySchedule, CustodyPattern, CustodyTemplate, CUSTODY_TEMPLATES } from '../../core/models/custody-schedule.model';

@Component({
  standalone: true,
  selector: 'app-custody-setup',
  templateUrl: './custody-setup.component.html',
  styleUrls: ['./custody-setup.component.scss'],
  imports: [IonicModule, CommonModule, FormsModule]
})
export class CustodySetupComponent implements OnInit {
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

  constructor(
    private modalController: ModalController,
    private calendarService: CalendarService
  ) {}

  ngOnInit() {
    // טען משמרת קיימת אם יש
    const existing = this.calendarService.loadCustodySchedule();
    if (existing) {
      this.custodySchedule = existing;
      this.step = 'customize';
    }
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
    this.custodySchedule.id = `schedule_${Date.now()}`;
    this.calendarService.saveCustodySchedule(this.custodySchedule);
    await this.modalController.dismiss({ saved: true });
  }

  async cancel() {
    await this.modalController.dismiss({ saved: false });
  }

  async deleteSchedule() {
    this.calendarService.deleteCustodySchedule();
    await this.modalController.dismiss({ deleted: true });
  }
}
