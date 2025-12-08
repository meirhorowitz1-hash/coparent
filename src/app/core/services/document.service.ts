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
  setDoc
} from '@angular/fire/firestore';
import { BehaviorSubject, Subscription, distinctUntilChanged, switchMap, of } from 'rxjs';

import { DocumentItem } from '../models/document.model';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';
import { UserProfile } from '../models/user-profile.model';
import { FamilyService } from './family.service';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { useServerBackend } from './backend-mode';
import { compressImageFile } from '../utils/image-compression';

const MAX_BYTES = 900 * 1024; // keep under Firestore 1MB limit

// Server API types
interface ServerDocument {
  id: string;
  familyId: string;
  title: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  childId?: string | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  uploadedAt: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class DocumentService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly familyService = inject(FamilyService);
  private readonly apiService = inject(ApiService);
  private readonly socketService = inject(SocketService);

  private documentsSubject = new BehaviorSubject<DocumentItem[]>([]);
  readonly documents$ = this.documentsSubject.asObservable();
  private childrenSubject = new BehaviorSubject<string[]>([]);
  readonly children$ = this.childrenSubject.asObservable();

  private profileSub?: Subscription;
  private documentsSub?: Subscription;
  private socketSub?: Subscription;
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
    this.socketSub?.unsubscribe();
  }

  // ==================== PUBLIC API ====================

  async uploadDocument(title: string, file: File, childId: string | null = null): Promise<DocumentItem> {
    if (useServerBackend()) {
      return this.uploadDocumentServer(title, file, childId);
    }
    return this.uploadDocumentFirebase(title, file, childId);
  }

  async deleteDocument(id: string): Promise<void> {
    if (useServerBackend()) {
      return this.deleteDocumentServer(id);
    }
    return this.deleteDocumentFirebase(id);
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

  // ==================== SERVER BACKEND METHODS ====================

  private async uploadDocumentServer(title: string, file: File, childId: string | null): Promise<DocumentItem> {
    const familyId = this.requireFamilyId();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    if (childId) {
      formData.append('childId', childId);
    }
    formData.append('uploadedByName', this.currentProfile?.fullName || this.currentProfile?.email || 'משתמש');

    const response = await this.apiService.upload<ServerDocument>(`/documents/${familyId}`, formData).toPromise();
    return this.mapServerDocument(response!);
  }

  private async deleteDocumentServer(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    await this.apiService.delete(`/documents/${familyId}/${id}`).toPromise();
  }

  private async loadDocumentsFromServer(familyId: string): Promise<void> {
    try {
      const docs = await this.apiService.get<ServerDocument[]>(`/documents/${familyId}`).toPromise();
      const mapped = (docs || []).map(d => this.mapServerDocument(d));
      this.documentsSubject.next(mapped);
    } catch (error) {
      console.error('[Document] Failed to load from server', error);
    }
  }

  private subscribeToServerEvents(): void {
    this.socketSub?.unsubscribe();

    this.socketSub = this.socketService.allEvents$.subscribe(({ event, data }) => {
      if (event === 'document:created') {
        const document = this.mapServerDocument(data as ServerDocument);
        const current = this.documentsSubject.value;
        if (!current.some(d => d.id === document.id)) {
          this.documentsSubject.next([document, ...current]);
        }
      } else if (event === 'document:deleted') {
        const { id } = data as { id: string };
        const next = this.documentsSubject.value.filter(d => d.id !== id);
        this.documentsSubject.next(next);
      }
    });
  }

  private mapServerDocument(data: ServerDocument): DocumentItem {
    return {
      id: data.id,
      title: data.title,
      fileName: data.fileName,
      childId: data.childId || null,
      downloadUrl: data.fileUrl,
      uploadedAt: new Date(data.uploadedAt),
      uploadedBy: data.uploadedById || undefined,
      uploadedByName: data.uploadedByName || undefined
    };
  }

  // ==================== FIREBASE BACKEND METHODS ====================

  private async uploadDocumentFirebase(title: string, file: File, childId: string | null): Promise<DocumentItem> {
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

  private async deleteDocumentFirebase(id: string): Promise<void> {
    const familyId = this.requireFamilyId();
    await deleteDoc(doc(this.firestore, 'families', familyId, 'documents', id));
  }

  // ==================== SUBSCRIPTION LOGIC ====================

  private subscribeToFamilyDocuments(familyId: string | null) {
    this.documentsSub?.unsubscribe();
    this.socketSub?.unsubscribe();

    if (!familyId) {
      this.documentsSubject.next([]);
      this.childrenSubject.next([]);
      return;
    }

    if (useServerBackend()) {
      this.loadDocumentsFromServer(familyId);
      this.subscribeToServerEvents();
    } else {
      this.subscribeToFirebaseDocuments(familyId);
    }
  }

  private subscribeToFirebaseDocuments(familyId: string): void {
    const documentsRef = collection(this.firestore, 'families', familyId, 'documents');
    const q = query(documentsRef, orderBy('uploadedAt', 'desc'));

    this.documentsSub = collectionData(q, { idField: 'id' }).subscribe(rawDocs => {
      const mapped = rawDocs.map(doc => this.mapDocument(doc)) as DocumentItem[];
      this.documentsSubject.next(mapped);
    });
  }

  // ==================== UTILITIES ====================

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
    const compressed = await compressImageFile(file, {
      maxDimension: 1280,
      maxBytes: MAX_BYTES,
      initialQuality: 0.92,
      minQuality: 0.35,
      qualityStep: 0.07,
      scaleStep: 0.9,
      minScale: 0.3
    });

    if (!compressed) {
      throw new Error('file-too-large');
    }

    return compressed;
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
