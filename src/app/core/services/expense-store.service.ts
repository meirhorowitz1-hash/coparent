import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docSnapshots,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from '@angular/fire/firestore';
import { BehaviorSubject, Subscription, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { UserProfile } from '../models/user-profile.model';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { useServerBackend } from './backend-mode';

export type ExpenseStatus = 'pending' | 'approved' | 'rejected';

export interface ExpenseRecord {
  id: string;
  title: string;
  amount: number;
  date: Date;
  createdBy: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  notes?: string;
  receiptName?: string;
  receiptPreview?: string;
  splitParent1: number; // percentage (0-100)
  status: ExpenseStatus;
  isPaid: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface FinanceSettings {
  alimonyAmount: number;
  alimonyPayer: 'parent1' | 'parent2' | null;
  defaultSplitParent1: number;
  fixedExpenses: FixedExpenseSetting[];
}

export interface FixedExpenseSetting {
  id: string;
  title: string;
  amount: number;
  splitParent1: number;
}

type FirestoreExpense = Omit<ExpenseRecord, 'date' | 'createdAt'> & {
  date: Timestamp | Date | string | number;
  createdAt: Timestamp | Date | string | number;
  updatedAt?: Timestamp | Date | string | number | null;
};

// Server API response types
interface ServerExpense {
  id: string;
  familyId: string;
  title: string;
  amount: number;
  date: string;
  notes?: string | null;
  receiptUrl?: string | null;
  receiptName?: string | null;
  splitParent1: number;
  status: ExpenseStatus;
  isPaid: boolean;
  createdById: string;
  createdByName?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface ServerFinanceSettings {
  id: string;
  familyId: string;
  alimonyAmount: number;
  alimonyPayer: 'parent1' | 'parent2' | null;
  defaultSplitParent1: number;
  fixedExpenses: Array<{
    id: string;
    title: string;
    amount: number;
    splitParent1: number;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class ExpenseStoreService implements OnDestroy {
  private static readonly STORAGE_KEY = 'coparent:expenses';
  private static readonly SETTINGS_STORAGE_KEY = 'coparent:finance-settings';
  private static readonly DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
    alimonyAmount: 0,
    alimonyPayer: null,
    defaultSplitParent1: 50,
    fixedExpenses: []
  };

  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly apiService = inject(ApiService);
  private readonly socketService = inject(SocketService);

  private expensesSubject = new BehaviorSubject<ExpenseRecord[]>(this.loadFromStorage());
  readonly expenses$ = this.expensesSubject.asObservable();
  private financeSettingsSubject = new BehaviorSubject<FinanceSettings>(this.loadFinanceSettingsFromStorage());
  readonly financeSettings$ = this.financeSettingsSubject.asObservable();

  private profileSubscription?: Subscription;
  private expensesSubscription?: Subscription;
  private financeSettingsSubscription?: Subscription;
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
        this.subscribeToFamilyExpenses(this.activeFamilyId);
      });
  }

  ngOnDestroy(): void {
    this.profileSubscription?.unsubscribe();
    this.expensesSubscription?.unsubscribe();
    this.financeSettingsSubscription?.unsubscribe();
    this.socketSubscription?.unsubscribe();
  }

  // ==================== PUBLIC API ====================

  addExpense(
    expense: Omit<ExpenseRecord, 'id' | 'createdAt' | 'status' | 'isPaid'> &
      Partial<Pick<ExpenseRecord, 'status' | 'isPaid' | 'id'>>
  ): Promise<ExpenseRecord> {
    if (useServerBackend()) {
      return this.addExpenseServer(expense);
    }
    return this.addExpenseFirebase(expense);
  }

  setStatus(id: string, status: ExpenseStatus): Promise<void> {
    if (useServerBackend()) {
      return this.setStatusServer(id, status);
    }
    return this.setStatusFirebase(id, status);
  }

  togglePaid(id: string): Promise<void> {
    if (useServerBackend()) {
      return this.togglePaidServer(id);
    }
    return this.togglePaidFirebase(id);
  }

  updateExpense(
    id: string,
    updates: Partial<Pick<ExpenseRecord, 'title' | 'amount' | 'date' | 'notes' | 'splitParent1' | 'receiptName' | 'receiptPreview'>>
  ): Promise<void> {
    if (useServerBackend()) {
      return this.updateExpenseServer(id, updates);
    }
    return this.updateExpenseFirebase(id, updates);
  }

  deleteExpense(id: string): Promise<void> {
    if (useServerBackend()) {
      return this.deleteExpenseServer(id);
    }
    return this.deleteExpenseFirebase(id);
  }

  updateFinanceSettings(patch: Partial<FinanceSettings>): Promise<void> {
    if (useServerBackend()) {
      return this.updateFinanceSettingsServer(patch);
    }
    return this.updateFinanceSettingsFirebase(patch);
  }

  clear(): void {
    const empty: ExpenseRecord[] = [];
    this.expensesSubject.next(empty);
    this.persist(empty);
  }

  getAll(): ExpenseRecord[] {
    return [...this.expensesSubject.value];
  }

  // ==================== SERVER BACKEND METHODS ====================

  private async addExpenseServer(
    expense: Omit<ExpenseRecord, 'id' | 'createdAt' | 'status' | 'isPaid'> &
      Partial<Pick<ExpenseRecord, 'status' | 'isPaid' | 'id'>>
  ): Promise<ExpenseRecord> {
    const familyId = this.requireFamilyId();
    const currentUser = this.resolveCurrentUser(expense);

    const payload = {
      title: expense.title,
      amount: expense.amount,
      date: new Date(expense.date).toISOString(),
      notes: expense.notes?.trim() || null,
      splitParent1: typeof expense.splitParent1 === 'number' ? expense.splitParent1 : 50,
      receiptUrl: expense.receiptPreview || null,
      receiptName: expense.receiptName?.trim() || null,
      createdByName: currentUser.name
    };

    const response = await this.apiService.post<ServerExpense>(`/expenses/${familyId}`, payload).toPromise();
    const record = this.mapServerExpense(response!);
    
    // Update local state immediately
    const current = this.expensesSubject.value;
    this.expensesSubject.next([record, ...current]);
    this.persist(this.expensesSubject.value);
    
    return record;
  }

  private async setStatusServer(id: string, status: ExpenseStatus): Promise<void> {
    const familyId = this.requireFamilyId();
    const response = await this.apiService.patch<ServerExpense>(`/expenses/${familyId}/${id}/status`, {
      status,
      updatedByName: this.getCurrentUserName()
    }).toPromise();
    
    // Update local state immediately
    if (response) {
      const updated = this.mapServerExpense(response);
      const current = this.expensesSubject.value;
      const next = current.map(e => e.id === id ? updated : e);
      this.expensesSubject.next(next);
      this.persist(next);
    }
  }

  private async togglePaidServer(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const response = await this.apiService.patch<ServerExpense>(`/expenses/${familyId}/${id}/paid`, {
      updatedByName: this.getCurrentUserName()
    }).toPromise();
    
    // Update local state immediately
    if (response) {
      const updated = this.mapServerExpense(response);
      const current = this.expensesSubject.value;
      const next = current.map(e => e.id === id ? updated : e);
      this.expensesSubject.next(next);
      this.persist(next);
    }
  }

  private async updateExpenseServer(
    id: string,
    updates: Partial<Pick<ExpenseRecord, 'title' | 'amount' | 'date' | 'notes' | 'splitParent1' | 'receiptName' | 'receiptPreview'>>
  ): Promise<void> {
    const familyId = this.requireFamilyId();
    
    const payload: Record<string, unknown> = {
      updatedByName: this.getCurrentUserName()
    };
    
    if (updates.title !== undefined) payload['title'] = updates.title.trim();
    if (updates.amount !== undefined) payload['amount'] = updates.amount;
    if (updates.date !== undefined) payload['date'] = new Date(updates.date).toISOString();
    if (updates.notes !== undefined) payload['notes'] = updates.notes?.trim() || null;
    if (updates.splitParent1 !== undefined) payload['splitParent1'] = Math.min(100, Math.max(0, updates.splitParent1));
    if (updates.receiptName !== undefined) payload['receiptName'] = updates.receiptName?.trim() || null;
    if (updates.receiptPreview !== undefined) payload['receiptUrl'] = updates.receiptPreview || null;

    const response = await this.apiService.patch<ServerExpense>(`/expenses/${familyId}/${id}`, payload).toPromise();
    
    // Update local state immediately
    if (response) {
      const updated = this.mapServerExpense(response);
      const current = this.expensesSubject.value;
      const next = current.map(e => e.id === id ? updated : e);
      this.expensesSubject.next(next);
      this.persist(next);
    }
  }

  private async deleteExpenseServer(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.delete(`/expenses/${familyId}/${id}`).toPromise();
    
    // Update local state immediately
    const current = this.expensesSubject.value;
    const next = current.filter(e => e.id !== id);
    this.expensesSubject.next(next);
    this.persist(next);
  }

  private async updateFinanceSettingsServer(patch: Partial<FinanceSettings>): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.put(`/expenses/${familyId}/settings`, patch).toPromise();
  }

  private async loadExpensesFromServer(familyId: string): Promise<void> {
    try {
      const expenses = await this.apiService.get<ServerExpense[]>(`/expenses/${familyId}`).toPromise();
      const mapped = (expenses || []).map(e => this.mapServerExpense(e));
      this.expensesSubject.next(mapped);
      this.persist(mapped);
    } catch (error) {
      console.error('[ExpenseStore] Failed to load expenses from server', error);
    }
  }

  private async loadFinanceSettingsFromServer(familyId: string): Promise<void> {
    try {
      const settings = await this.apiService.get<ServerFinanceSettings>(`/expenses/${familyId}/settings`).toPromise();
      if (settings) {
        const mapped: FinanceSettings = {
          alimonyAmount: settings.alimonyAmount,
          alimonyPayer: settings.alimonyPayer,
          defaultSplitParent1: settings.defaultSplitParent1,
          fixedExpenses: settings.fixedExpenses.map(fe => ({
            id: fe.id,
            title: fe.title,
            amount: fe.amount,
            splitParent1: fe.splitParent1
          }))
        };
        this.financeSettingsSubject.next(mapped);
        this.persistFinanceSettings(mapped);
      }
    } catch (error) {
      console.error('[ExpenseStore] Failed to load finance settings from server', error);
    }
  }

  private subscribeToServerEvents(familyId: string): void {
    this.socketSubscription?.unsubscribe();
    
    // Connect to socket and join family room
    this.socketService.connect().then(() => {
      this.socketService.joinFamily(familyId);
      console.log('[ExpenseStore] Subscribed to socket events for family:', familyId);
    });
    
    this.socketSubscription = this.socketService.allEvents$.subscribe(({ event, data }) => {
      console.log('[ExpenseStore] Socket event received:', event);
      if (event === 'expense:created') {
        const expense = this.mapServerExpense(data as ServerExpense);
        const current = this.expensesSubject.value;
        // Only add if not already exists (avoid duplicates from local add)
        if (!current.some(e => e.id === expense.id)) {
          console.log('[ExpenseStore] Adding expense from socket:', expense.id);
          this.expensesSubject.next([expense, ...current]);
          this.persist(this.expensesSubject.value);
        }
      } else if (event === 'expense:updated') {
        const expense = this.mapServerExpense(data as ServerExpense);
        const current = this.expensesSubject.value;
        const index = current.findIndex(e => e.id === expense.id);
        if (index >= 0) {
          console.log('[ExpenseStore] Updating expense from socket:', expense.id);
          const next = [...current];
          next[index] = expense;
          this.expensesSubject.next(next);
          this.persist(next);
        }
      } else if (event === 'expense:deleted') {
        const { id } = data as { id: string };
        console.log('[ExpenseStore] Deleting expense from socket:', id);
        const next = this.expensesSubject.value.filter(e => e.id !== id);
        this.expensesSubject.next(next);
        this.persist(next);
      }
    });
  }

  private mapServerExpense(data: ServerExpense): ExpenseRecord {
    return {
      id: data.id,
      title: data.title,
      amount: data.amount,
      date: new Date(data.date),
      createdBy: data.createdById,
      createdByName: data.createdByName || undefined,
      updatedBy: data.updatedById || undefined,
      updatedByName: data.updatedByName || undefined,
      notes: data.notes || undefined,
      receiptName: data.receiptName || undefined,
      receiptPreview: data.receiptUrl || undefined,
      splitParent1: data.splitParent1,
      status: data.status,
      isPaid: data.isPaid,
      createdAt: new Date(data.createdAt),
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined
    };
  }

  // ==================== FIREBASE BACKEND METHODS ====================

  private addExpenseFirebase(
    expense: Omit<ExpenseRecord, 'id' | 'createdAt' | 'status' | 'isPaid'> &
      Partial<Pick<ExpenseRecord, 'status' | 'isPaid' | 'id'>>
  ): Promise<ExpenseRecord> {
    const familyId = this.requireFamilyId();
    const currentUser = this.resolveCurrentUser(expense);
    const record: ExpenseRecord = {
      ...expense,
      id: expense.id ?? crypto.randomUUID(),
      status: expense.status ?? 'pending',
      isPaid: expense.isPaid ?? false,
      createdBy: currentUser.uid,
      createdByName: currentUser.name,
      updatedBy: currentUser.uid,
      updatedByName: currentUser.name,
      createdAt: new Date(),
      date: new Date(expense.date),
      notes: expense.notes?.trim() || undefined,
      receiptName: expense.receiptName?.trim() || undefined,
      splitParent1: typeof expense.splitParent1 === 'number' ? expense.splitParent1 : 50
    };

    const current = this.expensesSubject.value;
    const next = [record, ...current];
    this.expensesSubject.next(next);
    this.persist(next);

    const payload = {
      title: record.title,
      amount: record.amount,
      date: Timestamp.fromDate(record.date),
      createdBy: record.createdBy,
      createdByName: record.createdByName,
      notes: record.notes ?? null,
      receiptName: record.receiptName ?? null,
      receiptPreview: record.receiptPreview ?? null,
      splitParent1: record.splitParent1,
      status: record.status,
      isPaid: record.isPaid,
      createdAt: serverTimestamp(),
      updatedBy: record.updatedBy ?? record.createdBy,
      updatedByName: record.updatedByName ?? record.createdByName,
      updatedAt: serverTimestamp()
    };

    return setDoc(doc(this.firestore, 'families', familyId, 'expenses', record.id), payload)
      .then(() => record)
      .catch(error => {
        this.expensesSubject.next(current);
        this.persist(current);
        throw error;
      });
  }

  private setStatusFirebase(id: string, status: ExpenseStatus): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.expensesSubject.value;
    const existing = current.find(expense => expense.id === id);
    const next = current.map(expense => {
      if (expense.id !== id) return expense;
      return {
        ...expense,
        status,
        isPaid: status === 'approved' ? expense.isPaid : false,
        updatedBy: this.currentProfile?.uid ?? expense.updatedBy,
        updatedByName: this.getCurrentUserName() ?? expense.updatedByName
      };
    });

    this.expensesSubject.next(next);
    this.persist(next);

    return updateDoc(doc(this.firestore, 'families', familyId, 'expenses', id), {
      status,
      isPaid: status === 'approved' ? existing?.isPaid ?? false : false,
      updatedBy: this.currentProfile?.uid ?? existing?.updatedBy ?? null,
      updatedByName: this.getCurrentUserName() ?? existing?.updatedByName ?? null,
      updatedAt: serverTimestamp()
    }).catch(error => {
      this.expensesSubject.next(current);
      this.persist(current);
      throw error;
    });
  }

  private togglePaidFirebase(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.expensesSubject.value;
    const existing = current.find(expense => expense.id === id);
    if (!existing) return Promise.resolve();

    const toggledPaid = !existing.isPaid;
    const nextStatus = existing.status === 'approved' ? existing.status : 'approved';
    const next = current.map(expense => {
      if (expense.id !== id) return expense;
      return {
        ...expense,
        isPaid: toggledPaid,
        status: nextStatus,
        updatedBy: this.currentProfile?.uid ?? expense.updatedBy,
        updatedByName: this.getCurrentUserName() ?? expense.updatedByName
      };
    });

    this.expensesSubject.next(next);
    this.persist(next);

    return updateDoc(doc(this.firestore, 'families', familyId, 'expenses', id), {
      isPaid: toggledPaid,
      status: nextStatus,
      updatedBy: this.currentProfile?.uid ?? existing.updatedBy ?? null,
      updatedByName: this.getCurrentUserName() ?? existing.updatedByName ?? null,
      updatedAt: serverTimestamp()
    }).catch(error => {
      this.expensesSubject.next(current);
      this.persist(current);
      throw error;
    });
  }

  private updateExpenseFirebase(
    id: string,
    updates: Partial<Pick<ExpenseRecord, 'title' | 'amount' | 'date' | 'notes' | 'splitParent1' | 'receiptName' | 'receiptPreview'>>
  ): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.expensesSubject.value;
    const existing = current.find(expense => expense.id === id);
    if (!existing) return Promise.resolve();
    if (existing.status !== 'pending') return Promise.reject(new Error('cannot-edit-non-pending'));

    const patched: ExpenseRecord = {
      ...existing,
      ...updates,
      title: updates.title?.trim() ?? existing.title,
      amount: typeof updates.amount === 'number' ? updates.amount : existing.amount,
      date: updates.date ? new Date(updates.date) : existing.date,
      notes: updates.notes?.trim() || existing.notes,
      splitParent1: typeof updates.splitParent1 === 'number'
        ? Math.min(100, Math.max(0, updates.splitParent1))
        : existing.splitParent1,
      receiptName: updates.receiptName?.trim() || existing.receiptName,
      receiptPreview: updates.receiptPreview ?? existing.receiptPreview,
      updatedBy: this.currentProfile?.uid ?? existing.updatedBy,
      updatedByName: this.getCurrentUserName() ?? existing.updatedByName
    };

    const next = current.map(expense => (expense.id === id ? patched : expense));
    this.expensesSubject.next(next);
    this.persist(next);

    return updateDoc(doc(this.firestore, 'families', familyId, 'expenses', id), {
      title: patched.title,
      amount: patched.amount,
      date: Timestamp.fromDate(patched.date),
      notes: patched.notes ?? null,
      splitParent1: patched.splitParent1,
      receiptName: patched.receiptName ?? null,
      receiptPreview: patched.receiptPreview ?? null,
      updatedBy: patched.updatedBy ?? null,
      updatedByName: patched.updatedByName ?? null,
      updatedAt: serverTimestamp()
    }).catch(error => {
      this.expensesSubject.next(current);
      this.persist(current);
      throw error;
    });
  }

  private deleteExpenseFirebase(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.expensesSubject.value;
    const existing = current.find(expense => expense.id === id);
    if (!existing) return Promise.resolve();
    if (existing.status !== 'pending') return Promise.reject(new Error('cannot-delete-non-pending'));

    const next = current.filter(expense => expense.id !== id);
    this.expensesSubject.next(next);
    this.persist(next);

    return deleteDoc(doc(this.firestore, 'families', familyId, 'expenses', id)).catch(error => {
      this.expensesSubject.next(current);
      this.persist(current);
      throw error;
    });
  }

  private updateFinanceSettingsFirebase(patch: Partial<FinanceSettings>): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.financeSettingsSubject.value;
    const next: FinanceSettings = {
      alimonyAmount: typeof patch.alimonyAmount === 'number' ? patch.alimonyAmount : current.alimonyAmount,
      alimonyPayer:
        patch.alimonyPayer === 'parent1' || patch.alimonyPayer === 'parent2' || patch.alimonyPayer === null
          ? patch.alimonyPayer
          : current.alimonyPayer,
      defaultSplitParent1:
        typeof patch.defaultSplitParent1 === 'number'
          ? Math.min(100, Math.max(0, patch.defaultSplitParent1))
          : current.defaultSplitParent1,
      fixedExpenses: Array.isArray(patch.fixedExpenses)
        ? patch.fixedExpenses.map(item => ({
            id: item.id || crypto.randomUUID(),
            title: (item.title || '').trim(),
            amount: Number(item.amount) || 0,
            splitParent1:
              typeof item.splitParent1 === 'number'
                ? Math.min(100, Math.max(0, item.splitParent1))
                : current.defaultSplitParent1
          }))
        : current.fixedExpenses
    };

    this.financeSettingsSubject.next(next);
    this.persistFinanceSettings(next);

    const financeRef = doc(this.firestore, 'families', familyId, 'settings', 'finance');
    return setDoc(
      financeRef,
      {
        alimonyAmount: next.alimonyAmount,
        alimonyPayer: next.alimonyPayer ?? null,
        defaultSplitParent1: next.defaultSplitParent1,
        fixedExpenses: next.fixedExpenses,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    ).catch(error => {
      this.financeSettingsSubject.next(current);
      this.persistFinanceSettings(current);
      throw error;
    });
  }

  // ==================== SUBSCRIPTION LOGIC ====================

  private subscribeToFamilyExpenses(familyId: string | null) {
    console.log('[ExpenseStore] subscribeToFamilyExpenses called with:', familyId);
    
    this.expensesSubscription?.unsubscribe();
    this.financeSettingsSubscription?.unsubscribe();
    this.socketSubscription?.unsubscribe();

    if (!familyId) {
      console.log('[ExpenseStore] No familyId, clearing expenses');
      this.expensesSubject.next([]);
      this.persist([]);
      this.financeSettingsSubject.next(ExpenseStoreService.DEFAULT_FINANCE_SETTINGS);
      this.persistFinanceSettings(ExpenseStoreService.DEFAULT_FINANCE_SETTINGS);
      return;
    }

    if (useServerBackend()) {
      console.log('[ExpenseStore] Server mode - loading from API and subscribing to socket');
      // Server mode: load via API and subscribe to socket events
      this.loadExpensesFromServer(familyId);
      this.loadFinanceSettingsFromServer(familyId);
      this.subscribeToServerEvents(familyId);
    } else {
      // Firebase mode: use Firestore real-time subscriptions
      this.subscribeToFirebaseExpenses(familyId);
      this.subscribeToFirebaseFinanceSettings(familyId);
    }
  }

  private subscribeToFirebaseExpenses(familyId: string): void {
    const expensesRef = collection(this.firestore, 'families', familyId, 'expenses');
    const expensesQuery = query(expensesRef, orderBy('date', 'desc'));

    this.expensesSubscription = collectionData(expensesQuery, { idField: 'id' })
      .pipe(
        map(data => data.map(item => this.mapFromFirestore(item as FirestoreExpense & { id: string })))
      )
      .subscribe(expenses => {
        this.expensesSubject.next(expenses);
        this.persist(expenses);
      });
  }

  private subscribeToFirebaseFinanceSettings(familyId: string): void {
    const financeRef = doc(this.firestore, 'families', familyId, 'settings', 'finance');
    this.financeSettingsSubscription = docSnapshots(financeRef).subscribe(snapshot => {
      if (!snapshot.exists()) {
        const defaults = ExpenseStoreService.DEFAULT_FINANCE_SETTINGS;
        this.financeSettingsSubject.next(defaults);
        this.persistFinanceSettings(defaults);
        return;
      }

      const data = snapshot.data() as Partial<FinanceSettings>;
      const next: FinanceSettings = {
        alimonyAmount: typeof data.alimonyAmount === 'number' ? data.alimonyAmount : 0,
        alimonyPayer: data.alimonyPayer === 'parent1' || data.alimonyPayer === 'parent2' ? data.alimonyPayer : null,
        defaultSplitParent1:
          typeof data.defaultSplitParent1 === 'number'
            ? Math.min(100, Math.max(0, data.defaultSplitParent1))
            : ExpenseStoreService.DEFAULT_FINANCE_SETTINGS.defaultSplitParent1,
        fixedExpenses: Array.isArray((data as any).fixedExpenses)
          ? (data as any).fixedExpenses.map((item: Partial<FixedExpenseSetting>) => ({
              id: item.id || crypto.randomUUID(),
              title: (item.title || '').trim(),
              amount: typeof item.amount === 'number' ? item.amount : 0,
              splitParent1:
                typeof item.splitParent1 === 'number'
                  ? Math.min(100, Math.max(0, item.splitParent1))
                  : ExpenseStoreService.DEFAULT_FINANCE_SETTINGS.defaultSplitParent1
            }))
          : []
      };
      this.financeSettingsSubject.next(next);
      this.persistFinanceSettings(next);
    });
  }

  // ==================== UTILITIES ====================

  private persist(expenses: ExpenseRecord[]): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const serializable = expenses.map(expense => ({
        ...expense,
        date: expense.date.toISOString(),
        createdAt: expense.createdAt.toISOString(),
        updatedAt: expense.updatedAt ? expense.updatedAt.toISOString() : undefined
      }));
      localStorage.setItem(ExpenseStoreService.STORAGE_KEY, JSON.stringify(serializable));
    } catch (error) {
      console.warn('Failed to persist expenses history', error);
    }
  }

  private loadFromStorage(): ExpenseRecord[] {
    if (typeof localStorage === 'undefined') return [];

    try {
      const raw = localStorage.getItem(ExpenseStoreService.STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as Array<
        Omit<ExpenseRecord, 'date' | 'createdAt'> & { date: string; createdAt: string }
      >;

      return parsed.map(expense => ({
        ...expense,
        date: new Date(expense.date),
        createdAt: new Date(expense.createdAt),
        updatedAt: expense.updatedAt ? new Date(expense.updatedAt) : undefined,
        createdBy: expense.createdBy ?? 'unknown',
        createdByName: expense.createdByName ?? 'הורה'
      }));
    } catch (error) {
      console.warn('Failed to read expenses history, starting fresh', error);
      return [];
    }
  }

  private persistFinanceSettings(settings: FinanceSettings): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(ExpenseStoreService.SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('Failed to persist finance settings', error);
    }
  }

  private loadFinanceSettingsFromStorage(): FinanceSettings {
    if (typeof localStorage === 'undefined') return ExpenseStoreService.DEFAULT_FINANCE_SETTINGS;

    try {
      const raw = localStorage.getItem(ExpenseStoreService.SETTINGS_STORAGE_KEY);
      if (!raw) return ExpenseStoreService.DEFAULT_FINANCE_SETTINGS;
      
      const parsed = JSON.parse(raw) as Partial<FinanceSettings>;
      return {
        alimonyAmount: typeof parsed.alimonyAmount === 'number' ? parsed.alimonyAmount : 0,
        alimonyPayer:
          parsed.alimonyPayer === 'parent1' || parsed.alimonyPayer === 'parent2' ? parsed.alimonyPayer : null,
        defaultSplitParent1:
          typeof parsed.defaultSplitParent1 === 'number'
            ? Math.min(100, Math.max(0, parsed.defaultSplitParent1))
            : ExpenseStoreService.DEFAULT_FINANCE_SETTINGS.defaultSplitParent1,
        fixedExpenses: Array.isArray((parsed as any).fixedExpenses)
          ? (parsed as any).fixedExpenses.map((item: Partial<FixedExpenseSetting>) => ({
              id: item.id || crypto.randomUUID(),
              title: (item.title || '').trim(),
              amount: typeof item.amount === 'number' ? item.amount : 0,
              splitParent1:
                typeof item.splitParent1 === 'number'
                  ? Math.min(100, Math.max(0, item.splitParent1))
                  : ExpenseStoreService.DEFAULT_FINANCE_SETTINGS.defaultSplitParent1
            }))
          : []
      };
    } catch (error) {
      console.warn('Failed to read finance settings, using defaults', error);
      return ExpenseStoreService.DEFAULT_FINANCE_SETTINGS;
    }
  }

  private mapFromFirestore(data: FirestoreExpense & { id: string }): ExpenseRecord {
    return {
      ...data,
      date: this.toDate(data.date),
      createdAt: this.toDate(data.createdAt),
      createdBy: data.createdBy ?? 'unknown',
      createdByName: data.createdByName ?? 'הורה',
      notes: data.notes || undefined,
      receiptName: data.receiptName || undefined,
      receiptPreview: data.receiptPreview || undefined,
      splitParent1: typeof data.splitParent1 === 'number' ? data.splitParent1 : 50,
      status: data.status ?? 'pending',
      isPaid: data.isPaid ?? false,
      updatedBy: data.updatedBy,
      updatedByName: data.updatedByName,
      updatedAt: data.updatedAt ? this.toDate(data.updatedAt) : undefined
    };
  }

  private toDate(value: Timestamp | Date | string | number | null | undefined): Date {
    if (!value) return new Date();
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    return new Date(value);
  }

  private resolveCurrentUser(expense: Partial<ExpenseRecord>): { uid: string; name: string } {
    const uid = expense.createdBy ?? this.currentProfile?.uid ?? 'unknown';
    const name = expense.createdByName ?? this.getCurrentUserName();
    return { uid, name };
  }

  private getCurrentUserName(): string {
    return (
      this.currentProfile?.fullName ||
      this.currentProfile?.email ||
      (this.currentProfile as any)?.displayName ||
      this.currentProfile?.uid ||
      'הורה'
    );
  }

  private requireFamilyId(): string {
    if (!this.activeFamilyId) {
      throw new Error('missing-family-context');
    }
    return this.activeFamilyId;
  }
}
