import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';

import { TaskCategory } from '../../core/models/task.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { CalendarService } from '../../core/services/calendar.service';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-task-form-modal',
  templateUrl: './task-form-modal.component.html',
  styleUrls: ['./task-form-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule, TranslatePipe]
})
export class TaskFormModalComponent implements OnInit, OnDestroy {
  taskForm: FormGroup;
  parentNames = { parent1: '', parent2: '' };
  children: string[] = [];
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private taskHistoryService: TaskHistoryService,
    private calendarService: CalendarService,
    private i18n: I18nService
  ) {
    this.taskForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      dueDate: [null],
      assignedTo: ['both'],
      category: [TaskCategory.OTHER],
      childId: [null]
    });
  }

  ngOnInit(): void {
    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentNames = {
          parent1: metadata.parent1.name || '',
          parent2: metadata.parent2.name || ''
        };
      });

    this.calendarService.getFamilyChildren()
      .pipe(takeUntil(this.destroy$))
      .subscribe((children: string[]) => (this.children = children ?? []));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async save() {
    if (this.taskForm.invalid) {
      this.taskForm.markAllAsTouched();
      return;
    }

    const { title, description, dueDate, assignedTo, category, childId } = this.taskForm.value;

    try {
      await this.taskHistoryService.addTask({
        title: (title as string).trim(),
        description: (description as string)?.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: 'medium' as any,
        assignedTo: assignedTo || 'both',
        category: category as TaskCategory,
        createdBy: 'local',
        childId: childId || null
      });

      await this.presentToast(this.i18n.translate('tasks.toast.added'), 'success');
      this.modalCtrl.dismiss({ saved: true }, 'confirm');
    } catch (error: any) {
      const message =
        error?.message === 'missing-family-context'
          ? this.i18n.translate('tasks.toast.missingFamily')
          : this.i18n.translate('tasks.toast.saveFailed');
      await this.presentToast(message, 'danger');
      console.error('Failed to add task', error);
    }
  }

  getParentLabel(role: 'parent1' | 'parent2'): string {
    const label = this.parentNames[role];
    if (label) {
      return label;
    }
    return this.i18n.translate(role === 'parent1' ? 'profile.parent1' : 'profile.parent2');
  }

  clearDate() {
    this.taskForm.get('dueDate')?.setValue(null);
  }

  selectChild(childId: string | null) {
    this.taskForm.get('childId')?.setValue(childId);
  }

  private async presentToast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color
    });
    await toast.present();
  }
}
