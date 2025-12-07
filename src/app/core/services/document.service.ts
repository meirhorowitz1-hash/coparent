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
  setDoc
} from '@angular/fire/firestore';
import { BehaviorSubject, Subscription, distinctUntilChanged, switchMap, of } from 'rxjs';

import { DocumentItem } from '../models/document.model';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { UserProfile } from '../models/user-profile.model';
import { FamilyService } from './family.service';

const MAX_BYTES = 900 * 1024; // keep under Firestore 1MB limit

@Injectable({
  providedIn: 'root'
})
export class DocumentService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly familyService = inject(FamilyService);

  private documentsSubject = new BehaviorSubject<DocumentItem[]>([]);
  readonly documents$ = this.documentsSubject.asObservable();
  private childrenSubject = new BehaviorSubject<string[]>([]);
  readonly children$ = this.childrenSubject.asObservable();

  private profileSub?: Subscription;
  private documentsSub?: Subscription;
  private currentProfile: UserProfile | null = null;
  private activeFamilyId: string | null = null;

  constructor() {
    this.profileSub = this.authService.user$
      .pipe(
        switchMap(user => (user ? this.userProfileService.listenToProfile(user.uid) : of(null))),
        distinctUntilChanged((prev, curr) => prev?.activeFamilyId === curr?.activeFamilyId)
      )
      .subscribe(profile => {
        this.currentProfile = profile;
        this.activeFamilyId = profile?.activeFamilyId ?? null;
        this.subscribeToFamilyDocuments(this.activeFamilyId);
        this.refreshChildren(this.activeFamilyId);
      });
  }

  ngOnDestroy(): void {
    this.profileSub?.unsubscribe();
    this.documentsSub?.unsubscribe();
  }

  private subscribeToFamilyDocuments(familyId: string | null) {
    this.documentsSub?.unsubscribe();

    if (!familyId) {
      this.documentsSubject.next([]);
      this.childrenSubject.next([]);
      return;
    }

    const documentsRef = collection(this.firestore, 'families', familyId, 'documents');
    const q = query(documentsRef, orderBy('uploadedAt', 'desc'));

    this.documentsSub = collectionData(q, { idField: 'id' }).subscribe(rawDocs => {
      const mapped = rawDocs.map(doc => this.mapDocument(doc)) as DocumentItem[];
      this.documentsSubject.next(mapped);
    });
  }

  async uploadDocument(title: string, file: File, childId: string | null = null): Promise<DocumentItem> {
    const familyId = this.requireFamilyId();
    const user = this.authService.currentUser;

    const docRef = doc(collection(this.firestore, 'families', familyId, 'documents'));
    const dataUrl = await this.readFileAsSafeDataUrl(file);

    const payload = {
      title: title.trim(),
      fileName: file.name,
      childId: childId || null,
      dataUrl,
      uploadedAt: serverTimestamp(),
      uploadedBy: user?.uid ?? null,
      uploadedByName: this.currentProfile?.fullName || this.currentProfile?.email || 'משתמש'
    };

    try {
      await setDoc(docRef, payload);
      console.info('[DocumentService] saved to Firestore', {
        id: docRef.id,
        familyId,
        fileName: file.name,
        size: file.size
      });

      return {
        id: docRef.id,
        title: payload.title,
        fileName: payload.fileName,
        childId: payload.childId ?? null,
        dataUrl,
        uploadedAt: new Date(),
        uploadedBy: payload.uploadedBy || undefined,
        uploadedByName: payload.uploadedByName
      };
    } catch (error) {
      console.error('[DocumentService] Firestore save failed', {
        message: (error as any)?.message,
        code: (error as any)?.code
      });
      throw error;
    }
  }

  private mapDocument(doc: any): DocumentItem {
    const uploadedAt = doc.uploadedAt instanceof Timestamp ? doc.uploadedAt.toDate() : new Date();

    return {
      id: doc.id,
      title: doc.title ?? '',
      fileName: doc.fileName ?? '',
      childId: doc.childId ?? null,
      downloadUrl: doc.downloadUrl || undefined,
      storagePath: doc.storagePath || undefined,
      dataUrl: doc.dataUrl || undefined,
      uploadedAt,
      uploadedBy: doc.uploadedBy || undefined,
      uploadedByName: doc.uploadedByName || undefined
    };
  }

  /**
   * Return data URL that is safely under Firestore 1MB value limit.
   * Images are recompressed; other files are rejected if too large.
   */
  private async readFileAsSafeDataUrl(file: File): Promise<string> {
    if (file.type.startsWith('image/')) {
      return this.compressImage(file);
    }

    if (file.size > MAX_BYTES) {
      throw new Error('file-too-large');
    }

    return this.readFileAsDataUrl(file);
  }

  private async compressImage(file: File): Promise<string> {
    const img = await this.readImage(file);
    // scale down keeping aspect ratio; start with max dimension 1280
    const maxDim = 1280;
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('no-canvas-context');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.92;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);

    const sizeOf = (data: string) => Math.ceil((data.length - data.indexOf(',') - 1) * 3 / 4);
    while (sizeOf(dataUrl) > MAX_BYTES && quality > 0.35) {
      quality -= 0.07;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (sizeOf(dataUrl) > MAX_BYTES) {
      throw new Error('file-too-large');
    }

    return dataUrl;
  }

  private readImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private requireFamilyId(): string {
    if (!this.activeFamilyId) {
      throw new Error('no-family');
    }
    return this.activeFamilyId;
  }

  async getFamilyChildren(): Promise<string[]> {
    if (!this.activeFamilyId) {
      return [];
    }
    const cached = this.childrenSubject.value;
    if (cached.length) {
      return cached;
    }
    await this.refreshChildren(this.activeFamilyId);
    return this.childrenSubject.value;
  }

  private async refreshChildren(familyId: string | null) {
    if (!familyId) {
      this.childrenSubject.next([]);
      return;
    }
    try {
      const meta = await this.familyService.getFamilyMeta(familyId);
      this.childrenSubject.next(meta?.children ?? []);
    } catch (error) {
      console.error('Failed to fetch family children for documents', error);
      this.childrenSubject.next([]);
    }
  }
}
