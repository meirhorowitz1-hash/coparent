import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalController, LoadingController } from '@ionic/angular';
import { CalendarService } from '../../core/services/calendar.service';
import {
  CustodySchedule,
  CustodyPattern,
  CustodyTemplate,
  CustodyScheduleApprovalRequest,
  CUSTODY_TEMPLATES
} from '../../core/models/custody-schedule.model';
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
    biweeklyAltParent1Days: [],
    biweeklyAltParent2Days: [],
    isActive: true,
    pendingApproval: null
  };
  parentLabels = { parent1: 'הורה 1', parent2: 'הורה 2' };
  pendingApproval: CustodyScheduleApprovalRequest | null = null;
  currentSchedule: CustodySchedule | null = null;
  requiresPartnerApproval = false;
  currentUserId: string | null = null;
  currentUserParentRole: 'parent1' | 'parent2' | null = null;
  activeBiweeklyWeek: 'a' | 'b' = 'a';

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
    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentLabels = {
          parent1: metadata.parent1.name || 'הורה 1',
          parent2: metadata.parent2.name || 'הורה 2'
        };
        this.requiresPartnerApproval = !!(metadata.parent1.uid && metadata.parent2.uid);
        const uid = this.calendarService.getCurrentUserId();
        this.currentUserId = uid;
        this.currentUserParentRole = this.calendarService.getParentRoleForUser(uid);
      });

    this.calendarService.custodySchedule$
      .pipe(takeUntil(this.destroy$))
      .subscribe(schedule => {
        if (schedule) {
          this.currentSchedule = schedule;
          this.pendingApproval = schedule.pendingApproval ?? null;
          const source = schedule.pendingApproval ?? schedule;
          const biAltParent1 = (source as any).biweeklyAltParent1Days ?? (schedule as any).biweeklyAltParent1Days ?? [];
          const biAltParent2 = (source as any).biweeklyAltParent2Days ?? (schedule as any).biweeklyAltParent2Days ?? [];

          this.custodySchedule = {
            ...schedule,
            ...source,
            parent1Days: [...source.parent1Days],
            parent2Days: [...source.parent2Days],
            biweeklyAltParent1Days: [...biAltParent1],
            biweeklyAltParent2Days: [...biAltParent2],
            startDate: new Date(source.startDate)
          };
          this.step = 'confirm';
          this.resolveSelectedTemplate(schedule);
        } else {
          this.currentSchedule = null;
          this.pendingApproval = null;
          this.step = 'template';
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectTemplate(template: CustodyTemplate) {
    if (this.pendingApproval) {
      return;
    }

    this.selectedTemplate = template;
    this.custodySchedule.pattern = template.pattern;
    this.custodySchedule.name = template.nameHebrew;
    this.activeBiweeklyWeek = 'a';
    
    if (template.id !== 'custom') {
      this.custodySchedule.parent1Days = [...template.parent1Days];
      this.custodySchedule.parent2Days = [...template.parent2Days];
      this.custodySchedule.biweeklyAltParent1Days = [];
      this.custodySchedule.biweeklyAltParent2Days = [];
      this.step = 'confirm';
    } else {
      this.step = 'customize';
    }
  }

  toggleDay(parent: 'parent1' | 'parent2', day: number) {
    if (this.pendingApproval) {
      return;
    }

    const days = this.getActiveParentDays(parent);
    const index = days.indexOf(day);
    
    if (index > -1) {
      days.splice(index, 1);
    } else {
      days.push(day);
      // הסר מההורה השני
      const otherParent = parent === 'parent1' ? 'parent2' : 'parent1';
      const otherDays = this.getActiveParentDays(otherParent);
      const otherIndex = otherDays.indexOf(day);
      if (otherIndex > -1) {
        otherDays.splice(otherIndex, 1);
      }
    }
  }

  isDaySelected(parent: 'parent1' | 'parent2', day: number): boolean {
    const days = this.getActiveParentDays(parent);
    return days.includes(day);
  }

  goToCustomize() {
    if (this.pendingApproval) {
      return;
    }
    this.step = 'customize';
  }

  goToConfirm() {
    if (this.pendingApproval) {
      return;
    }
    const hasAnyDay =
      this.custodySchedule.parent1Days.length > 0 ||
      this.custodySchedule.parent2Days.length > 0 ||
      (this.custodySchedule.biweeklyAltParent1Days?.length ?? 0) > 0 ||
      (this.custodySchedule.biweeklyAltParent2Days?.length ?? 0) > 0;
    if (!hasAnyDay) {
      return;
    }
    this.step = 'confirm';
  }

  get isApprovalPending(): boolean {
    return !!this.pendingApproval;
  }

  get isWaitingForOtherParent(): boolean {
    return !!(this.pendingApproval && this.pendingApproval.requestedBy === this.currentUserId);
  }

  get isAwaitingMyApproval(): boolean {
    return !!(this.pendingApproval && this.pendingApproval.requestedBy !== this.currentUserId);
  }

  get awaitingParentName(): string {
    const otherRole = this.currentUserParentRole === 'parent1' ? 'parent2' : 'parent1';
    return this.parentLabels[otherRole] || 'הורה שותף';
  }

  get startDateIso(): string {
    return this.custodySchedule.startDate
      ? new Date(this.custodySchedule.startDate).toISOString()
      : new Date().toISOString();
  }

  onStartDateChange(value: string | string[] | null) {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (!normalized) {
      return;
    }
    const next = new Date(normalized);
    if (!isNaN(next.getTime())) {
      this.custodySchedule.startDate = next;
    }
  }

  describeTemplate(template: CustodyTemplate): string {
    return template.description
      .replace(/הורה 1/g, this.parentLabels.parent1)
      .replace(/הורה 2/g, this.parentLabels.parent2);
  }

  private getActiveParentDays(parent: 'parent1' | 'parent2'): number[] {
    if (this.custodySchedule.pattern !== CustodyPattern.BIWEEKLY || this.activeBiweeklyWeek === 'a') {
      return parent === 'parent1' ? this.custodySchedule.parent1Days : this.custodySchedule.parent2Days;
    }

    const key = parent === 'parent1' ? 'biweeklyAltParent1Days' : 'biweeklyAltParent2Days';
    if (!this.custodySchedule[key]) {
      this.custodySchedule[key] = [];
    }
    return this.custodySchedule[key] as number[];
  }

  private resolveSelectedTemplate(schedule: CustodySchedule) {
    const match = this.templates.find(
      template =>
        template.pattern === schedule.pattern &&
        template.parent1Days.length === schedule.parent1Days.length &&
        template.parent2Days.length === schedule.parent2Days.length &&
        template.parent1Days.every(day => schedule.parent1Days.includes(day)) &&
        template.parent2Days.every(day => schedule.parent2Days.includes(day))
    );

    this.selectedTemplate = match || this.templates.find(t => t.id === 'custom') || null;
  }

  async save() {
    if (this.isProcessing) {
      return;
    }

    if (this.pendingApproval) {
      return;
    }

    this.custodySchedule.id = this.custodySchedule.id || `schedule_${Date.now()}`;
    const requestApproval = this.requiresPartnerApproval && !!this.currentUserId;
    const loader = await this.presentProgressLoader(requestApproval ? 'שולח לאישור...' : 'מעדכן את המשמרות...');

    this.isProcessing = true;

    const savePromise = this.calendarService
      .saveCustodySchedule(this.custodySchedule, {
        requestApproval,
        baseSchedule: this.currentSchedule,
        requestedBy: this.calendarService.getCurrentUserId(),
        requestedByName: this.calendarService.getCurrentUserDisplayName()
      })
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

  async respondToPending(approve: boolean) {
    if (!this.pendingApproval || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const loader = await this.presentProgressLoader(approve ? 'מאשר את ההצעה...' : 'דוחה את ההצעה...');

    const actionPromise = this.calendarService
      .respondToCustodyApproval(approve)
      .catch(error => console.error('Failed to respond to custody approval', error))
      .finally(() => {
        loader.dismiss();
        this.isProcessing = false;
      });

    await actionPromise;
    if (approve) {
      await this.modalController.dismiss({ saved: true, approved: true });
    }
  }

  async cancelPendingRequest() {
    if (!this.pendingApproval || this.pendingApproval.requestedBy !== this.currentUserId || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const loader = await this.presentProgressLoader('מבטל את הבקשה...');

    const actionPromise = this.calendarService
      .cancelCustodyApprovalRequest()
      .catch(error => console.error('Failed to cancel custody approval request', error))
      .finally(() => {
        loader.dismiss();
        this.isProcessing = false;
      });

    await actionPromise;
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
