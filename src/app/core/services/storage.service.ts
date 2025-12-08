import { Injectable, OnDestroy, Injector, inject } from '@angular/core';
import { Firestore, doc, onSnapshot, Unsubscribe } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BehaviorSubject, Observable, of, Subscription } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { AuthService } from './auth.service';

export interface StorageBreakdown {
  paymentReceipts: number;
  documents: number;
  expenseReceipts: number;
}

export interface StorageStats {
  totalUsed: number;
  limit: number;
  percentage: number;
  remaining: number;
  breakdown: StorageBreakdown;
}

const DEFAULT_STATS: StorageStats = {
  totalUsed: 0,
  limit: 5 * 1024 * 1024 * 1024, // 5GB
  percentage: 0,
  remaining: 5 * 1024 * 1024 * 1024,
  breakdown: {
    paymentReceipts: 0,
    documents: 0,
    expenseReceipts: 0
  }
};

@Injectable({
  providedIn: 'root'
})
export class StorageService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly authService = inject(AuthService);
  private readonly injector = inject(Injector);

  private statsSubject = new BehaviorSubject<StorageStats>(DEFAULT_STATS);
  readonly stats$ = this.statsSubject.asObservable();

  private profileSubscription?: Subscription;
  private firestoreUnsubscribe?: Unsubscribe;
  private currentFamilyId: string | null = null;
  private initialized = false;

  private safeNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  ngOnDestroy(): void {
    this.profileSubscription?.unsubscribe();
    this.firestoreUnsubscribe?.();
  }

  /**
   * Initialize the service (call from component or after app init)
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Lazy import to avoid circular dependency
    import('./user-profile.service').then(({ UserProfileService }) => {
      const userProfileService = this.injector.get(UserProfileService);
      
      this.profileSubscription = this.authService.user$
        .pipe(
          switchMap(user => (user ? userProfileService.listenToProfile(user.uid) : of(null))),
          map(profile => profile?.activeFamilyId ?? null),
          distinctUntilChanged()
        )
        .subscribe(familyId => {
          this.currentFamilyId = familyId;
          this.subscribeToFamilyStorage(familyId);
        });
    });
  }

  // ==================== PUBLIC API ====================

  /**
   * Get current storage stats (snapshot)
   */
  getStats(): StorageStats {
    return this.statsSubject.value;
  }

  /**
   * Check if there's enough space for a file
   */
  hasSpaceFor(fileSize: number): boolean {
    const stats = this.statsSubject.value;
    return stats.remaining >= fileSize;
  }

  /**
   * Check storage limit via Cloud Function (more accurate)
   * @param fileSize Size of file in bytes
   * @param familyId Optional - if not provided, uses current family
   */
  async checkStorageLimit(fileSize: number, familyId?: string): Promise<{
    allowed: boolean;
    currentUsage: number;
    limit: number;
    remaining: number;
    percentage: number;
  }> {
    const targetFamilyId = familyId ?? this.currentFamilyId;
    if (!targetFamilyId) {
      throw new Error('missing-family-context');
    }

    const checkFn = httpsCallable<
      { familyId: string; fileSize: number },
      { allowed: boolean; currentUsage: number; limit: number; remaining: number; percentage: number }
    >(this.functions, 'checkStorageLimit');

    const result = await checkFn({ familyId: targetFamilyId, fileSize });
    return result.data;
  }

  /**
   * Force recalculate storage from server
   */
  async recalculateStorage(): Promise<StorageStats> {
    if (!this.currentFamilyId) {
      throw new Error('missing-family-context');
    }

    const recalculateFn = httpsCallable<{ familyId: string }, StorageStats>(
      this.functions,
      'recalculateStorage'
    );

    const result = await recalculateFn({ familyId: this.currentFamilyId });
    return result.data;
  }

  /**
   * Set storage limit for the family (admin use)
   */
  async setStorageLimit(limitBytes: number): Promise<{
    success: boolean;
    newLimit: number;
    stats: StorageStats;
  }> {
    if (!this.currentFamilyId) {
      throw new Error('missing-family-context');
    }

    const setLimitFn = httpsCallable<
      { familyId: string; limitBytes: number },
      { success: boolean; newLimit: number; stats: StorageStats }
    >(this.functions, 'setFamilyStorageLimit');

    const result = await setLimitFn({ familyId: this.currentFamilyId, limitBytes });
    return result.data;
  }

  /**
   * Format bytes to human-readable string
   */
 formatBytes(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);

  // tweak decimals as you like
  const decimals = i === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

  /**
   * Calculate size of a base64 data URL
   */
  getDataUrlSize(dataUrl: string): number {
    if (!dataUrl || typeof dataUrl !== 'string') return 0;
    const base64 = dataUrl.split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  }

  // ==================== PRIVATE ====================

  private subscribeToFamilyStorage(familyId: string | null): void {
    this.firestoreUnsubscribe?.();

    if (!familyId) {
      this.statsSubject.next(DEFAULT_STATS);
      return;
    }

    const familyRef = doc(this.firestore, 'families', familyId);

    this.firestoreUnsubscribe = onSnapshot(
      familyRef,
      snapshot => {
        const data = snapshot.data();
        const storageStats = data?.['storageStats'];

        if (storageStats) {
          const totalUsed = this.safeNumber(storageStats['totalUsed'], 0);
          const limitValue = this.safeNumber(storageStats['limit'], DEFAULT_STATS.limit);
          const limit = limitValue > 0 ? limitValue : DEFAULT_STATS.limit;
          const fallbackRemaining = Math.max(0, limit - totalUsed);
          const breakdown = storageStats['breakdown'] ?? {};
          const defaultPercentage = limit > 0 ? Math.min(100, Math.round((totalUsed / limit) * 100)) : 0;
          const percentage = Math.min(
            100,
            Math.max(0, this.safeNumber(storageStats['percentage'], defaultPercentage))
          );
          const rawRemaining = this.safeNumber(storageStats['remaining'], fallbackRemaining);
          const remaining = Number.isFinite(rawRemaining) ? Math.max(0, rawRemaining) : fallbackRemaining;

          this.statsSubject.next({
            totalUsed,
            limit,
            percentage,
            remaining,
            breakdown: {
              paymentReceipts: Math.max(0, this.safeNumber(breakdown['paymentReceipts'], 0)),
              documents: Math.max(0, this.safeNumber(breakdown['documents'], 0)),
              expenseReceipts: Math.max(0, this.safeNumber(breakdown['expenseReceipts'], 0))
            }
          });
        } else {
          // No stats yet, trigger recalculation
          this.statsSubject.next(DEFAULT_STATS);
        }
      },
      error => {
        console.error('[StorageService] Failed to subscribe to storage stats', error);
        this.statsSubject.next(DEFAULT_STATS);
      }
    );
  }
}
