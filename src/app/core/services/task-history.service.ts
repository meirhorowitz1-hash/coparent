import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from '@angular/fire/firestore';
import { BehaviorSubject, Subscription, of } from 'rxjs';
import { distinctUntilChanged, switchMap } from 'rxjs/operators';

import { Task, TaskCategory, TaskPriority, TaskStatus } from '../models/task.model';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { UserProfile } from '../models/user-profile.model';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { useServerBackend } from './backend-mode';

type FirestoreTask = Omit<Task, 'dueDate' | 'createdAt' | 'completedAt'> & {
  dueDate?: Timestamp | Date | string | number | null;
  createdAt: Timestamp | Date | string | number;
  completedAt?: Timestamp | Date | string | number | null;
};

// Server API response type
interface ServerTask {
  id: string;
  familyId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: 'parent1' | 'parent2' | 'both';
  category: TaskCategory;
  childId?: string | null;
  createdById: string;
  createdByName?: string | null;
  completedAt?: string | null;
  completedById?: string | null;
  createdAt: string;
  updatedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TaskHistoryService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly apiService = inject(ApiService);
  private readonly socketService = inject(SocketService);

  private tasksSubject = new BehaviorSubject<Task[]>([]);
  readonly tasks$ = this.tasksSubject.asObservable();

  private profileSubscription?: Subscription;
  private tasksSubscription?: Subscription;
  private socketSubscription?: Subscription;
  private currentProfile: UserProfile | null = null;
  private activeFamilyId: string | null = null;

  constructor() {
    this.profileSubscription = this.authService.user$
      .pipe(
        switchMap(user => (user ? this.userProfileService.listenToProfile(user.uid) : of(null))),
        distinctUntilChanged((prev, curr) => prev?.activeFamilyId === curr?.activeFamilyId)
      )
      .subscribe(profile => {
        this.currentProfile = profile;
        this.activeFamilyId = profile?.activeFamilyId ?? null;
        this.subscribeToFamilyTasks(this.activeFamilyId);
      });
  }

  ngOnDestroy(): void {
    this.profileSubscription?.unsubscribe();
    this.tasksSubscription?.unsubscribe();
    this.socketSubscription?.unsubscribe();
  }

  // ==================== PUBLIC API ====================

  async addTask(
    task: Omit<Task, 'id' | 'createdAt' | 'status'> & Partial<Pick<Task, 'id' | 'status'>>
  ): Promise<Task> {
    if (useServerBackend()) {
      return this.addTaskServer(task);
    }
    return this.addTaskFirebase(task);
  }

  async updateTask(
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'priority' | 'assignedTo' | 'category' | 'childId'>>
  ): Promise<void> {
    if (useServerBackend()) {
      return this.updateTaskServer(id, updates);
    }
    return this.updateTaskFirebase(id, updates);
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    if (useServerBackend()) {
      return this.updateStatusServer(id, status);
    }
    return this.updateStatusFirebase(id, status);
  }

  async deleteTask(id: string): Promise<void> {
    if (useServerBackend()) {
      return this.deleteTaskServer(id);
    }
    return this.deleteTaskFirebase(id);
  }

  getAll(): Task[] {
    return [...this.tasksSubject.value];
  }

  // ==================== SERVER BACKEND METHODS ====================

  private async addTaskServer(
    task: Omit<Task, 'id' | 'createdAt' | 'status'> & Partial<Pick<Task, 'id' | 'status'>>
  ): Promise<Task> {
    const familyId = this.requireFamilyId();
    const { name } = this.resolveCurrentUser();

    const payload = {
      title: task.title,
      description: task.description || null,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      priority: task.priority,
      status: task.status ?? TaskStatus.PENDING,
      assignedTo: task.assignedTo ?? 'both',
      category: task.category ?? TaskCategory.OTHER,
      childId: task.childId || null,
      createdByName: name
    };

    const response = await this.apiService.post<ServerTask>(`/tasks/${familyId}`, payload).toPromise();
    return this.mapServerTask(response!);
  }

  private async updateTaskServer(
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'priority' | 'assignedTo' | 'category' | 'childId'>>
  ): Promise<void> {
    const familyId = this.requireFamilyId();
    
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload['title'] = updates.title;
    if (updates.description !== undefined) payload['description'] = updates.description || null;
    if (updates.dueDate !== undefined) payload['dueDate'] = updates.dueDate ? new Date(updates.dueDate).toISOString() : null;
    if (updates.priority !== undefined) payload['priority'] = updates.priority;
    if (updates.assignedTo !== undefined) payload['assignedTo'] = updates.assignedTo;
    if (updates.category !== undefined) payload['category'] = updates.category;
    if (updates.childId !== undefined) payload['childId'] = updates.childId || null;

    await this.apiService.patch(`/tasks/${familyId}/${id}`, payload).toPromise();
  }

  private async updateStatusServer(id: string, status: TaskStatus): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.patch(`/tasks/${familyId}/${id}/status`, { status }).toPromise();
  }

  private async deleteTaskServer(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.delete(`/tasks/${familyId}/${id}`).toPromise();
  }

  private async loadTasksFromServer(familyId: string): Promise<void> {
    try {
      const tasks = await this.apiService.get<ServerTask[]>(`/tasks/${familyId}`).toPromise();
      const mapped = (tasks || []).map(t => this.mapServerTask(t));
      this.tasksSubject.next(mapped);
    } catch (error) {
      console.error('[TaskHistory] Failed to load tasks from server', error);
    }
  }

  private subscribeToServerEvents(familyId: string): void {
    this.socketSubscription?.unsubscribe();

    this.socketSubscription = this.socketService.allEvents$.subscribe(({ event, data }) => {
      if (event === 'task:created' || event === 'task:updated') {
        const task = this.mapServerTask(data as ServerTask);
        const current = this.tasksSubject.value;
        const index = current.findIndex(t => t.id === task.id);

        if (index >= 0) {
          const next = [...current];
          next[index] = task;
          this.tasksSubject.next(next);
        } else {
          this.tasksSubject.next([task, ...current]);
        }
      } else if (event === 'task:deleted') {
        const { id } = data as { id: string };
        const next = this.tasksSubject.value.filter(t => t.id !== id);
        this.tasksSubject.next(next);
      }
    });
  }

  private mapServerTask(data: ServerTask): Task {
    return {
      id: data.id,
      title: data.title,
      description: data.description || undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      priority: data.priority,
      status: data.status,
      assignedTo: data.assignedTo,
      category: data.category,
      childId: data.childId || null,
      createdBy: data.createdById,
      createdAt: new Date(data.createdAt),
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      completedBy: data.completedById || undefined
    };
  }

  // ==================== FIREBASE BACKEND METHODS ====================

  private async addTaskFirebase(
    task: Omit<Task, 'id' | 'createdAt' | 'status'> & Partial<Pick<Task, 'id' | 'status'>>
  ): Promise<Task> {
    const familyId = this.requireFamilyId();
    const { uid, name } = this.resolveCurrentUser();

    const record: Task = {
      ...task,
      id: task.id ?? crypto.randomUUID(),
      status: task.status ?? TaskStatus.PENDING,
      createdAt: new Date(),
      dueDate: task.dueDate ? new Date(task.dueDate) : null,
      createdBy: uid,
      childId: task.childId ?? null,
      completedAt: task.status === TaskStatus.COMPLETED ? new Date() : undefined
    };

    const prev = this.tasksSubject.value;
    this.tasksSubject.next([record, ...prev]);

    try {
      await setDoc(doc(this.firestore, 'families', familyId, 'tasks', record.id), {
        title: record.title,
        description: record.description ?? null,
        dueDate: record.dueDate ? Timestamp.fromDate(record.dueDate) : null,
        priority: record.priority,
        status: record.status,
        assignedTo: record.assignedTo ?? 'both',
        category: record.category ?? TaskCategory.OTHER,
        childId: record.childId ?? null,
        createdBy: record.createdBy,
        createdByName: name,
        createdAt: serverTimestamp(),
        completedAt: record.completedAt ? Timestamp.fromDate(record.completedAt) : null
      });
      return record;
    } catch (error) {
      this.tasksSubject.next(prev);
      throw error;
    }
  }

  private async updateTaskFirebase(
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'priority' | 'assignedTo' | 'category' | 'childId'>>
  ): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.tasksSubject.value;
    const existing = current.find(task => task.id === id);
    if (!existing) return;

    const updated: Task = {
      ...existing,
      ...updates,
      dueDate: updates.dueDate !== undefined ? (updates.dueDate ? new Date(updates.dueDate) : null) : existing.dueDate
    };

    const next = current.map(task => (task.id === id ? updated : task));
    this.tasksSubject.next(next);

    try {
      const payload: { updatedAt: ReturnType<typeof serverTimestamp>; [key: string]: any } = { updatedAt: serverTimestamp() };
      if (updates.title !== undefined) payload['title'] = updates.title;
      if (updates.description !== undefined) payload['description'] = updates.description ?? null;
      if (updates.dueDate !== undefined) payload['dueDate'] = updates.dueDate ? Timestamp.fromDate(new Date(updates.dueDate)) : null;
      if (updates.priority !== undefined) payload['priority'] = updates.priority;
      if (updates.assignedTo !== undefined) payload['assignedTo'] = updates.assignedTo;
      if (updates.category !== undefined) payload['category'] = updates.category;
      if (updates.childId !== undefined) payload['childId'] = updates.childId ?? null;

      await updateDoc(doc(this.firestore, 'families', familyId, 'tasks', id), payload);
    } catch (error) {
      this.tasksSubject.next(current);
      throw error;
    }
  }

  private async updateStatusFirebase(id: string, status: TaskStatus): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.tasksSubject.value;
    const existing = current.find(task => task.id === id);
    if (!existing) return;

    const updated: Task = {
      ...existing,
      status,
      completedAt: status === TaskStatus.COMPLETED ? new Date() : undefined
    };

    const next = current.map(task => (task.id === id ? updated : task));
    this.tasksSubject.next(next);

    try {
      await updateDoc(doc(this.firestore, 'families', familyId, 'tasks', id), {
        status: updated.status,
        completedAt: updated.completedAt ? Timestamp.fromDate(updated.completedAt) : null,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      this.tasksSubject.next(current);
      throw error;
    }
  }

  private async deleteTaskFirebase(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.tasksSubject.value;
    const next = current.filter(task => task.id !== id);
    this.tasksSubject.next(next);

    try {
      await deleteDoc(doc(this.firestore, 'families', familyId, 'tasks', id));
    } catch (error) {
      this.tasksSubject.next(current);
      throw error;
    }
  }

  // ==================== SUBSCRIPTION LOGIC ====================

  private subscribeToFamilyTasks(familyId: string | null) {
    this.tasksSubscription?.unsubscribe();
    this.socketSubscription?.unsubscribe();

    if (!familyId) {
      this.tasksSubject.next([]);
      return;
    }

    if (useServerBackend()) {
      this.loadTasksFromServer(familyId);
      this.subscribeToServerEvents(familyId);
    } else {
      this.subscribeToFirebaseTasks(familyId);
    }
  }

  private subscribeToFirebaseTasks(familyId: string): void {
    const tasksRef = collection(this.firestore, 'families', familyId, 'tasks');
    const tasksQuery = query(tasksRef, orderBy('dueDate', 'asc'));

    this.tasksSubscription = collectionData(tasksQuery, { idField: 'id' }).subscribe(items => {
      const mapped = (items as Array<FirestoreTask & { id: string }>).map(item => this.mapFromFirestore(item));
      this.tasksSubject.next(mapped);
    });
  }

  // ==================== UTILITIES ====================

  private mapFromFirestore(item: FirestoreTask & { id: string }): Task {
    return {
      id: item.id,
      title: item.title,
      description: item.description ?? undefined,
      dueDate: item.dueDate ? this.toDate(item.dueDate) : null,
      priority: item.priority,
      status: item.status,
      assignedTo: item.assignedTo ?? 'both',
      category: item.category ?? TaskCategory.OTHER,
      childId: item.childId ?? null,
      createdBy: item.createdBy ?? 'unknown',
      createdAt: this.toDate(item.createdAt),
      completedAt: item.completedAt ? this.toDate(item.completedAt) : undefined,
      reminders: item.reminders
    };
  }

  private toDate(value: Timestamp | Date | string | number | null | undefined): Date {
    if (!value) return new Date();
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    return new Date(value);
  }

  private resolveCurrentUser(): { uid: string; name: string } {
    const uid = this.currentProfile?.uid ?? 'unknown';
    const name =
      this.currentProfile?.fullName ||
      this.currentProfile?.email ||
      (this.currentProfile as any)?.displayName ||
      this.currentProfile?.uid ||
      'הורה';

    return { uid, name };
  }

  private requireFamilyId(): string {
    if (!this.activeFamilyId) {
      throw new Error('missing-family-context');
    }
    return this.activeFamilyId;
  }
}
