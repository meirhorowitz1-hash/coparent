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
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BehaviorSubject, Subscription, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { UserProfile } from '../models/user-profile.model';
import { PaymentReceipt, MonthlyPaymentSummary } from '../models/payment-receipt.model';
import { I18nService } from './i18n.service';
import { compressImageFile, getDataUrlSize } from '../utils/image-compression';

type FirestorePaymentReceipt = Omit<PaymentReceipt, 'createdAt' | 'updatedAt'> & {
  createdAt: Timestamp | Date | string | number;
  updatedAt?: Timestamp | Date | string | number | null;
};

@Injectable({
  providedIn: 'root'
})
export class PaymentReceiptService implements OnDestroy {
  private static readonly STORAGE_KEY = 'coparent:payment-receipts';
  private static readonly MAX_IMAGE_BYTES = 900_000;

  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly i18n = inject(I18nService);

  private receiptsSubject = new BehaviorSubject<PaymentReceipt[]>(this.loadFromStorage());
  readonly receipts$ = this.receiptsSubject.asObservable();

  private profileSubscription?: Subscription;
  private receiptsSubscription?: Subscription;
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
        this.subscribeToFamilyReceipts(this.activeFamilyId);
      });
  }

  ngOnDestroy(): void {
    this.profileSubscription?.unsubscribe();
    this.receiptsSubscription?.unsubscribe();
  }

  // ==================== PUBLIC API ====================

  async addReceipt(receipt: Omit<PaymentReceipt, 'id' | 'createdAt' | 'paidBy' | 'paidByName'>): Promise<PaymentReceipt> {
    const familyId = this.requireFamilyId();
    console.log('[PaymentReceiptService] Adding receipt to family:', familyId);
    console.log('[PaymentReceiptService] Current user:', this.currentProfile?.uid);
    
    // Check storage limit before adding (server-side)
    const newImageSize = getDataUrlSize(receipt.imageUrl);
    try {
      const checkFn = httpsCallable<
        { familyId: string; fileSize: number },
        { allowed: boolean }
      >(this.functions, 'checkStorageLimit');
      
      const storageCheck = await checkFn({ familyId, fileSize: newImageSize });
      if (!storageCheck.data.allowed) {
        throw new Error('STORAGE_LIMIT_EXCEEDED');
      }
    } catch (error: any) {
      if (error?.message === 'STORAGE_LIMIT_EXCEEDED') {
        throw error;
      }
      // If server check fails, log but continue (optimistic approach)
      console.warn('[PaymentReceiptService] Storage check failed, continuing:', error);
    }
    
    const record: PaymentReceipt = {
      ...receipt,
      id: crypto.randomUUID(),
      familyId,
      paidBy: this.currentProfile?.uid ?? 'unknown',
      paidByName: this.getCurrentUserName(),
      createdAt: new Date()
    };

    const current = this.receiptsSubject.value;
    const next = [record, ...current];
    this.receiptsSubject.next(next);
    this.persist(next);

    const payload = {
      month: record.month,
      year: record.year,
      imageUrl: record.imageUrl,
      imageName: record.imageName ?? null,
      description: record.description ?? null,
      amount: record.amount ?? null,
      paidBy: record.paidBy,
      paidByName: record.paidByName ?? null,
      paidTo: record.paidTo,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    try {
      await setDoc(doc(this.firestore, 'families', familyId, 'paymentReceipts', record.id), payload);
      return record;
    } catch (error) {
      this.receiptsSubject.next(current);
      this.persist(current);
      throw error;
    }
  }

  async updateReceipt(
    id: string,
    updates: Partial<Pick<PaymentReceipt, 'description' | 'amount' | 'imageUrl' | 'imageName'>>
  ): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.receiptsSubject.value;
    const existing = current.find(r => r.id === id);
    if (!existing) return;

    const patched: PaymentReceipt = {
      ...existing,
      ...updates,
      updatedAt: new Date()
    };

    const next = current.map(r => (r.id === id ? patched : r));
    this.receiptsSubject.next(next);
    this.persist(next);

    try {
      await updateDoc(doc(this.firestore, 'families', familyId, 'paymentReceipts', id), {
        description: patched.description ?? null,
        amount: patched.amount ?? null,
        imageUrl: patched.imageUrl,
        imageName: patched.imageName ?? null,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      this.receiptsSubject.next(current);
      this.persist(current);
      throw error;
    }
  }

  async deleteReceipt(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    const current = this.receiptsSubject.value;
    const next = current.filter(r => r.id !== id);
    
    this.receiptsSubject.next(next);
    this.persist(next);

    try {
      await deleteDoc(doc(this.firestore, 'families', familyId, 'paymentReceipts', id));
    } catch (error) {
      this.receiptsSubject.next(current);
      this.persist(current);
      throw error;
    }
  }

  getReceiptsForMonth(month: number, year: number): PaymentReceipt[] {
    return this.receiptsSubject.value.filter(r => r.month === month && r.year === year);
  }

  getGroupedByMonth(): MonthlyPaymentSummary[] {
    const receipts = this.receiptsSubject.value;
    const buckets = new Map<string, MonthlyPaymentSummary>();

    receipts.forEach(receipt => {
      const key = `${receipt.year}-${receipt.month}`;
      if (!buckets.has(key)) {
        const baseDate = new Date(receipt.year, receipt.month, 1);
        const label = baseDate.toLocaleDateString(this.i18n.locale, {
          month: 'long',
          year: 'numeric'
        });
        buckets.set(key, {
          month: receipt.month,
          year: receipt.year,
          label,
          receipts: [],
          totalPaid: 0
        });
      }
      const bucket = buckets.get(key)!;
      bucket.receipts.push(receipt);
      bucket.totalPaid += receipt.amount ?? 0;
    });

    // Sort by date descending
    return Array.from(buckets.values()).sort((a, b) => {
      if (a.year === b.year) return b.month - a.month;
      return b.year - a.year;
    });
  }

  // ==================== IMAGE COMPRESSION ====================

  async compressImage(file: File, maxDimension = 1400, quality = 0.72): Promise<string | null> {
    return compressImageFile(file, {
      maxDimension,
      maxBytes: PaymentReceiptService.MAX_IMAGE_BYTES,
      initialQuality: quality,
      minQuality: 0.35,
      qualityStep: 0.07,
      scaleStep: 0.88,
      minScale: 0.25
    });
  }

  // ==================== SUBSCRIPTION LOGIC ====================

  private subscribeToFamilyReceipts(familyId: string | null) {
    this.receiptsSubscription?.unsubscribe();

    if (!familyId) {
      this.receiptsSubject.next([]);
      this.persist([]);
      return;
    }

    const receiptsRef = collection(this.firestore, 'families', familyId, 'paymentReceipts');
    const receiptsQuery = query(receiptsRef, orderBy('createdAt', 'desc'));

    this.receiptsSubscription = collectionData(receiptsQuery, { idField: 'id' })
      .pipe(
        map(data => data.map(item => this.mapFromFirestore(item as FirestorePaymentReceipt & { id: string })))
      )
      .subscribe(receipts => {
        this.receiptsSubject.next(receipts);
        this.persist(receipts);
      });
  }

  // ==================== UTILITIES ====================

  private persist(receipts: PaymentReceipt[]): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const serializable = receipts.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : undefined
      }));
      localStorage.setItem(PaymentReceiptService.STORAGE_KEY, JSON.stringify(serializable));
    } catch (error) {
      console.warn('Failed to persist payment receipts', error);
    }
  }

  private loadFromStorage(): PaymentReceipt[] {
    if (typeof localStorage === 'undefined') return [];

    try {
      const raw = localStorage.getItem(PaymentReceiptService.STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as Array<any>;
      return parsed.map(r => ({
        ...r,
        createdAt: new Date(r.createdAt),
        updatedAt: r.updatedAt ? new Date(r.updatedAt) : undefined
      }));
    } catch {
      return [];
    }
  }

  private mapFromFirestore(data: FirestorePaymentReceipt & { id: string }): PaymentReceipt {
    return {
      ...data,
      createdAt: this.toDate(data.createdAt),
      updatedAt: data.updatedAt ? this.toDate(data.updatedAt) : undefined
    };
  }

  private toDate(value: Timestamp | Date | string | number | null | undefined): Date {
    if (!value) return new Date();
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    return new Date(value);
  }

  private getCurrentUserName(): string {
    return this.currentProfile?.fullName || this.currentProfile?.email || 'הורה';
  }

  private requireFamilyId(): string {
    if (!this.activeFamilyId) {
      throw new Error('missing-family-context');
    }
    return this.activeFamilyId;
  }
}
