import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Task, TaskPriority, TaskStatus } from '../../core/models/task.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { I18nService } from '../../core/services/i18n.service';
import { TaskFormModalComponent } from '../../components/task-form-modal/task-form-modal.component';

@Component({
  selector: 'app-tasks',
  templateUrl: './tasks.page.html',
  styleUrls: ['./tasks.page.scss'],
  standalone: false
})
export class TasksPage implements OnInit, OnDestroy {
  TaskPriority = TaskPriority;
  TaskStatus = TaskStatus;

  tasks: Task[] = [];
  private destroy$ = new Subject<void>();
  private completionTimers = new Map<string, any>();

  constructor(
    private taskHistoryService: TaskHistoryService,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private i18n: I18nService
  ) {}

  ngOnInit(): void {
    this.taskHistoryService.tasks$
      .pipe(takeUntil(this.destroy$))
      .subscribe(tasks => {
        const getTime = (value: Date | string | null | undefined) => {
          if (!value) {
            return Number.MAX_SAFE_INTEGER;
          }
          const d = new Date(value);
          return isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
        };
        this.tasks = [...tasks].sort((a, b) => getTime(a.dueDate) - getTime(b.dueDate));
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get pendingCount(): number {
    return this.tasks.filter(task => task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED).length;
  }

  get openTasks(): Task[] {
    return this.tasks.filter(task => task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED);
  }

  async toggleCompletion(task: Task, completed: boolean): Promise<void> {
    const existingTimer = this.completionTimers.get(task.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.completionTimers.delete(task.id);
    }

    const nextStatus = completed ? TaskStatus.COMPLETED : TaskStatus.PENDING;
    if (task.status === nextStatus) {
      return;
    }

    if (completed) {
      const timer = setTimeout(async () => {
        this.completionTimers.delete(task.id);
        try {
          await this.taskHistoryService.updateStatus(task.id, TaskStatus.COMPLETED);
        } catch (error) {
          this.presentToast(this.i18n.translate('tasks.toast.updateFailed'), 'danger');
          console.error('Failed to update task status', error);
        }
      }, 3000);
      this.completionTimers.set(task.id, timer);
    } else {
      try {
        await this.taskHistoryService.updateStatus(task.id, TaskStatus.PENDING);
      } catch (error) {
        this.presentToast(this.i18n.translate('tasks.toast.updateFailed'), 'danger');
        console.error('Failed to update task status', error);
      }
    }
  }

  async openForm(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: TaskFormModalComponent
    });
    await modal.present();
  }

  async deleteTask(task: Task, event?: Event): Promise<void> {
    event?.stopPropagation();
    const confirmed = window.confirm(this.i18n.translate('tasks.confirm.delete'));
    if (!confirmed) {
      return;
    }
    try {
      await this.taskHistoryService.deleteTask(task.id);
      this.presentToast(this.i18n.translate('tasks.toast.deleteSuccess'), 'success');
    } catch (error) {
      console.error('Failed to delete task', error);
      this.presentToast(this.i18n.translate('tasks.toast.deleteFailed'), 'danger');
    }
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color
    });
    toast.present();
  }

  getStatusLabel(status: TaskStatus): string {
    const labels: Record<TaskStatus, string> = {
      [TaskStatus.PENDING]: this.i18n.translate('tasks.status.pending'),
      [TaskStatus.IN_PROGRESS]: this.i18n.translate('tasks.status.inProgress'),
      [TaskStatus.COMPLETED]: this.i18n.translate('tasks.status.completed'),
      [TaskStatus.CANCELLED]: this.i18n.translate('tasks.status.cancelled')
    };
    return labels[status];
  }

  formatDate(date: Date | string | null | undefined): string {
    if (!date) {
      return this.i18n.translate('tasks.noDueDate');
    }
    const value = new Date(date);
    if (isNaN(value.getTime())) {
      return this.i18n.translate('tasks.noDueDate');
    }
    return new Intl.DateTimeFormat(this.i18n.locale, { day: '2-digit', month: 'long' }).format(value);
  }
}
