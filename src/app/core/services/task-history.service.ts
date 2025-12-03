import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
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

type FirestoreTask = Omit<Task, 'dueDate' | 'createdAt' | 'completedAt'> & {
  dueDate?: Timestamp | Date | string | number | null;
  createdAt: Timestamp | Date | string | number;
  completedAt?: Timestamp | Date | string | number | null;
};

@Injectable({
  providedIn: 'root'
})
export class TaskHistoryService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);

  private tasksSubject = new BehaviorSubject<Task[]>([]);
  readonly tasks$ = this.tasksSubject.asObservable();

  private profileSubscription?: Subscription;
  private tasksSubscription?: Subscription;
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
  }

  async addTask(
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

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.tasksSubject.value;
    const existing = current.find(task => task.id === id);
    if (!existing) {
      return;
    }

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

  private subscribeToFamilyTasks(familyId: string | null) {
    this.tasksSubscription?.unsubscribe();

    if (!familyId) {
      this.tasksSubject.next([]);
      return;
    }

    const tasksRef = collection(this.firestore, 'families', familyId, 'tasks');
    const tasksQuery = query(tasksRef, orderBy('dueDate', 'asc'));

    this.tasksSubscription = collectionData(tasksQuery, { idField: 'id' }).subscribe(items => {
      const mapped = (items as Array<FirestoreTask & { id: string }>).map(item => this.mapFromFirestore(item));
      this.tasksSubject.next(mapped);
    });
  }

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
      createdBy: item.createdBy ?? 'unknown',
      createdAt: this.toDate(item.createdAt),
      completedAt: item.completedAt ? this.toDate(item.completedAt) : undefined,
      reminders: item.reminders
    };
  }

  private toDate(value: Timestamp | Date | string | number | null | undefined): Date {
    if (!value) {
      return new Date();
    }
    if (value instanceof Timestamp) {
      return value.toDate();
    }
    if (value instanceof Date) {
      return value;
    }
    return new Date(value);
  }

  getAll(): Task[] {
    return [...this.tasksSubject.value];
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
