import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Task, TaskCategory, TaskPriority, TaskStatus } from '../../core/models/task.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { CalendarService } from '../../core/services/calendar.service';

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
  showForm = false;
  newTaskForm: FormGroup;
  parentNames = { parent1: 'הורה 1', parent2: 'הורה 2' };
  children: string[] = [];
  private destroy$ = new Subject<void>();
  private completionTimers = new Map<string, any>();

  constructor(
    private taskHistoryService: TaskHistoryService,
    private fb: FormBuilder,
    private toastCtrl: ToastController,
    private calendarService: CalendarService
  ) {
    this.newTaskForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      dueDate: [null],
      assignedTo: ['both'],
      category: [TaskCategory.OTHER],
      childId: [null]
    });
  }

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

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentNames = {
          parent1: metadata.parent1.name || 'הורה 1',
          parent2: metadata.parent2.name || 'הורה 2'
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

  get pendingCount(): number {
    return this.tasks.filter(task => task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED).length;
  }

  get openTasks(): Task[] {
    return this.tasks.filter(task => task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED);
  }

  async addTask(): Promise<void> {
    if (this.newTaskForm.invalid) {
      this.newTaskForm.markAllAsTouched();
      return;
    }

    const { title, description, dueDate, assignedTo, category } = this.newTaskForm.value;
    try {
      await this.taskHistoryService.addTask({
        title: (title as string).trim(),
        description: (description as string)?.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: TaskPriority.MEDIUM,
        assignedTo: assignedTo || 'both',
        category: category as TaskCategory,
        createdBy: 'local',
        childId: this.newTaskForm.value.childId || null
      });

      this.newTaskForm.reset({
        title: '',
        description: '',
        dueDate: null,
        assignedTo: 'both',
        category: TaskCategory.OTHER,
        childId: null
      });
      this.showForm = false;
      this.presentToast('המשימה נוספה', 'success');
    } catch (error: any) {
      const message = error?.message === 'missing-family-context' ? 'אין משפחה פעילה מחוברת כרגע' : 'לא הצלחנו לשמור את המשימה';
      this.presentToast(message, 'danger');
      console.error('Failed to add task', error);
    }
  }

  async toggleCompletion(task: Task, completed: boolean): Promise<void> {
    // אם המשתמש מבטל סימון בזמן ההמתנה – לא נשלח עדכון
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
          this.presentToast('לא הצלחנו לעדכן משימה', 'danger');
          console.error('Failed to update task status', error);
        }
      }, 3000);
      this.completionTimers.set(task.id, timer);
    } else {
      try {
        await this.taskHistoryService.updateStatus(task.id, TaskStatus.PENDING);
      } catch (error) {
        this.presentToast('לא הצלחנו לעדכן משימה', 'danger');
        console.error('Failed to update task status', error);
      }
    }
  }

  openForm(): void {
    this.showForm = true;
  }

  async deleteTask(task: Task, event?: Event): Promise<void> {
    event?.stopPropagation();
    const confirmed = window.confirm('למחוק את המשימה? לא ניתן לבטל.');
    if (!confirmed) {
      return;
    }
    try {
      await this.taskHistoryService.deleteTask(task.id);
      this.presentToast('המשימה נמחקה', 'success');
    } catch (error) {
      console.error('Failed to delete task', error);
      this.presentToast('לא הצלחנו למחוק משימה', 'danger');
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
      [TaskStatus.PENDING]: 'ממתינה',
      [TaskStatus.IN_PROGRESS]: 'בתהליך',
      [TaskStatus.COMPLETED]: 'הושלמה',
      [TaskStatus.CANCELLED]: 'בוטלה'
    };
    return labels[status];
  }

  formatDate(date: Date | string | null | undefined): string {
    if (!date) {
      return 'ללא תאריך יעד';
    }
    const value = new Date(date);
    if (isNaN(value.getTime())) {
      return 'ללא תאריך יעד';
    }
    return value.toLocaleDateString('he-IL', { day: '2-digit', month: 'long' });
  }
}
