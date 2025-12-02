import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable, Subscription, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { SwapRequest, SwapRequestStatus, SwapRequestType } from '../models/swap-request.model';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { UserProfile } from '../models/user-profile.model';
import { Family } from '../models/family.model';
import { CalendarService } from './calendar.service';

type FirestoreSwapRequest = Omit<
  SwapRequest,
  'originalDate' | 'proposedDate' | 'createdAt' | 'respondedAt'
> & {
  originalDate: Timestamp;
  proposedDate?: Timestamp | null;
  createdAt: Timestamp | Date | null;
  respondedAt?: Timestamp | Date | null;
  requestType?: SwapRequestType;
};

@Injectable({
  providedIn: 'root'
})
export class SwapRequestService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly calendarService = inject(CalendarService);

  private swapRequestsSubject = new BehaviorSubject<SwapRequest[]>([]);
  readonly swapRequests$: Observable<SwapRequest[]> = this.swapRequestsSubject.asObservable();

  private activeFamilyIdSubject = new BehaviorSubject<string | null>(null);
  readonly activeFamilyId$ = this.activeFamilyIdSubject.asObservable();

  private requestsSubscription?: Subscription;
  private profileSubscription?: Subscription;
  private currentProfile: UserProfile | null = null;
  private currentUserId: string | null = null;

  constructor() {
    this.profileSubscription = this.authService.user$
      .pipe(
        switchMap(user => (user ? this.userProfileService.listenToProfile(user.uid) : of(null))),
        distinctUntilChanged((prev, curr) => prev?.activeFamilyId === curr?.activeFamilyId)
      )
      .subscribe(profile => {
        this.currentProfile = profile;
        this.currentUserId = profile?.uid ?? null;
        const familyId = profile?.activeFamilyId ?? null;
        this.activeFamilyIdSubject.next(familyId);
        this.subscribeToSwapRequests(familyId);
      });
  }

  ngOnDestroy(): void {
    this.requestsSubscription?.unsubscribe();
    this.profileSubscription?.unsubscribe();
  }

  /**
   * יוצר בקשת החלפה חדשה עבור המשפחה הפעילה
   */
  async createSwapRequest(payload: {
    originalDate: Date;
    proposedDate?: Date | null;
    reason?: string;
    requestType?: SwapRequestType;
  }): Promise<void> {
    const familyId = this.requireFamilyId();
    const requestedBy = this.currentProfile?.uid;

    if (!requestedBy) {
      throw new Error('missing-user-context');
    }

    const { requestedTo, requestedToName } = await this.resolveCounterparty(familyId, requestedBy);

    const originalDate = this.toDate(payload.originalDate);
    const proposedDate = payload.proposedDate ? this.toDate(payload.proposedDate) : null;
    const requestType: SwapRequestType = payload.requestType ?? (proposedDate ? 'swap' : 'one-way');

    this.validateSwapDates({
      requesterUid: requestedBy,
      requestType,
      originalDate,
      proposedDate
    });

    await addDoc(collection(this.firestore, 'families', familyId, 'swapRequests'), {
      requestedBy,
      requestedByName: this.currentProfile?.fullName || this.currentProfile?.email || 'משתמש',
      requestedTo: requestedTo ?? 'family',
      requestedToName: requestedToName ?? 'הורה שותף',
      originalDate: Timestamp.fromDate(originalDate),
      proposedDate: proposedDate ? Timestamp.fromDate(proposedDate) : null,
      requestType,
      reason: payload.reason?.trim() || null,
      status: SwapRequestStatus.PENDING,
      createdAt: serverTimestamp(),
      respondedAt: null,
      responseNote: null
    });
  }

  /**
   * עדכון סטטוס בקשה קיימת
   */
  async updateSwapRequestStatus(
    id: string,
    status: SwapRequestStatus,
    responseNote?: string
  ): Promise<void> {
    const familyId = this.requireFamilyId();
    const ref = doc(this.firestore, 'families', familyId, 'swapRequests', id);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      throw new Error('swap-request-not-found');
    }

    const data = snapshot.data() as FirestoreSwapRequest;
    const currentStatus = data.status;
    const userId = this.currentUserId;

    if (!userId) {
      throw new Error('missing-user-context');
    }

    if (currentStatus !== SwapRequestStatus.PENDING) {
      throw new Error('swap-request-not-pending');
    }

    if (status === SwapRequestStatus.CANCELLED) {
      if (data.requestedBy !== userId) {
        throw new Error('swap-request-cancel-forbidden');
      }
    } else if (status === SwapRequestStatus.APPROVED || status === SwapRequestStatus.REJECTED) {
      if (data.requestedTo !== userId) {
        throw new Error('swap-request-response-forbidden');
      }
    } else {
      throw new Error('swap-request-status-not-allowed');
    }

    const trimmedNote = responseNote?.trim() || null;

    await updateDoc(ref, {
      status,
      responseNote: trimmedNote,
      respondedAt: serverTimestamp()
    });

    const mappedRequest = {
      ...this.mapFromFirestore({ ...(data as FirestoreSwapRequest), id }),
      status,
      responseNote: trimmedNote || undefined
    };

    if (status === SwapRequestStatus.APPROVED) {
      await this.calendarService.applySwapRequestApproval(mappedRequest);
    } else {
      await this.calendarService.removeSwapRequestOverrides(id);
    }
  }

  private subscribeToSwapRequests(familyId: string | null) {
    this.requestsSubscription?.unsubscribe();

    if (!familyId) {
      this.swapRequestsSubject.next([]);
      return;
    }

    const swapRequestsRef = collection(this.firestore, 'families', familyId, 'swapRequests');
    const swapRequestsQuery = query(swapRequestsRef, orderBy('createdAt', 'desc'));

    this.requestsSubscription = collectionData(swapRequestsQuery, { idField: 'id' })
      .pipe(
        map(data => data.map(item => this.mapFromFirestore(item as FirestoreSwapRequest)))
      )
      .subscribe(requests => this.swapRequestsSubject.next(requests));
  }

  private mapFromFirestore(data: FirestoreSwapRequest & { id: string }): SwapRequest {
    return {
      ...data,
      originalDate: this.toDate(data.originalDate),
      proposedDate: data.proposedDate ? this.toDate(data.proposedDate) : null,
      requestType: data.requestType ?? (data.proposedDate ? 'swap' : 'one-way'),
      createdAt: this.toDate(data.createdAt),
      respondedAt: data.respondedAt ? this.toDate(data.respondedAt) : undefined,
      reason: data.reason || undefined,
      responseNote: data.responseNote || undefined
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

  private requireFamilyId(): string {
    const familyId = this.activeFamilyIdSubject.value;
    if (!familyId) {
      throw new Error('missing-family-context');
    }
    return familyId;
  }

  private async resolveCounterparty(
    familyId: string,
    requesterUid: string
  ): Promise<{ requestedTo?: string; requestedToName?: string }> {
    const familySnap = await getDoc(doc(this.firestore, 'families', familyId));

    if (!familySnap.exists()) {
      return {};
    }

    const family = familySnap.data() as Family;
    const members = family.members ?? [];
    const counterpartyUid = members.find(memberUid => memberUid !== requesterUid);

    if (!counterpartyUid) {
      return {};
    }

    const profileSnap = await getDoc(doc(this.firestore, 'users', counterpartyUid));

    if (!profileSnap.exists()) {
      return {
        requestedTo: counterpartyUid,
        requestedToName: 'הורה שותף'
      };
    }

    const profile = profileSnap.data() as UserProfile;

    return {
      requestedTo: counterpartyUid,
      requestedToName: profile.fullName || profile.email || 'הורה שותף'
    };
  }

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  private validateSwapDates(params: {
    requesterUid: string;
    requestType: SwapRequestType;
    originalDate: Date;
    proposedDate: Date | null;
  }): void {
    const requesterParent = this.calendarService.getParentRoleForUser(params.requesterUid);
    const originalParent = this.calendarService.getParentForDate(params.originalDate);

    if (!requesterParent || !originalParent || requesterParent !== originalParent) {
      throw new Error('swap-invalid-original-day');
    }

    if (params.requestType === 'swap') {
      if (!params.proposedDate) {
        throw new Error('swap-missing-proposed-day');
      }
      // אם יש תבנית משמורת ברורה והיום אצל ההורה השני – נוודא זאת; אחרת נאפשר שליחה
      const proposedParent = this.calendarService.getParentForDate(params.proposedDate);
      if (proposedParent && proposedParent === requesterParent) {
        throw new Error('swap-proposed-same-parent');
      }
    }
  }
}
