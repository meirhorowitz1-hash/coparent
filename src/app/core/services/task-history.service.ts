import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Task, TaskPriority, TaskStatus, TaskCategory } from '../models/task.model';

@Injectable({
  providedIn: 'root'
})
export class TaskHistoryService {
  private tasksSubject = new BehaviorSubject<Task[]>(this.buildSeedTasks());
  readonly tasks$ = this.tasksSubject.asObservable();

  addTask(task: Omit<Task, 'id' | 'createdAt' | 'status'> & Partial<Pick<Task, 'id' | 'status'>>): Task {
    const record: Task = {
      ...task,
      id: task.id ?? crypto.randomUUID(),
      status: task.status ?? TaskStatus.PENDING,
      createdAt: new Date(),
      dueDate: new Date(task.dueDate)
    };

    const next = [record, ...this.tasksSubject.value];
    this.tasksSubject.next(next);
    return record;
  }

  updateStatus(id: string, status: TaskStatus): void {
    const next = this.tasksSubject.value.map(task => {
      if (task.id !== id) {
        return task;
      }

      return {
        ...task,
        status,
        completedAt: status === TaskStatus.COMPLETED ? new Date() : undefined
      };
    });

    this.tasksSubject.next(next);
  }

  private buildSeedTasks(): Task[] {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 18);

    return [
      {
        id: crypto.randomUUID(),
        title: 'חיסון שגרתי במרפאה',
        description: 'להביא את פנקס החיסונים ולבדוק אם צריך אישור בית ספר',
        dueDate: now,
        priority: TaskPriority.URGENT,
        status: TaskStatus.IN_PROGRESS,
        assignedTo: 'parent1',
        category: TaskCategory.MEDICAL,
        createdBy: 'system',
        createdAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3)
      },
      {
        id: crypto.randomUUID(),
        title: 'תשלום חוג כדורגל',
        description: 'העברה בנקאית עד סוף החודש',
        dueDate: lastMonth,
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.COMPLETED,
        assignedTo: 'parent2',
        category: TaskCategory.ACTIVITY,
        createdBy: 'system',
        createdAt: new Date(lastMonth.getFullYear(), lastMonth.getMonth(), lastMonth.getDate() - 6),
        completedAt: new Date(lastMonth.getFullYear(), lastMonth.getMonth(), lastMonth.getDate() - 1)
      },
      {
        id: crypto.randomUUID(),
        title: 'קניית ציוד בית ספר',
        description: 'להכין רשימה מראש ולבדוק מבצעים',
        dueDate: twoMonthsAgo,
        priority: TaskPriority.HIGH,
        status: TaskStatus.PENDING,
        assignedTo: 'both',
        category: TaskCategory.SHOPPING,
        createdBy: 'system',
        createdAt: new Date(twoMonthsAgo.getFullYear(), twoMonthsAgo.getMonth(), twoMonthsAgo.getDate() - 2)
      }
    ];
  }
}
