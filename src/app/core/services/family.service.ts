import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  docData,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Family, FamilyInvite } from '../models/family.model';
import { UserProfile } from '../models/user-profile.model';
import { UserProfileService } from './user-profile.service';
import { ApiService } from './api.service';
import { useServerBackend } from './backend-mode';

// Server API types
interface ServerFamily {
  id: string;
  name?: string | null;
  ownerId: string;
  shareCode: string;
  photoUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
  members: Array<{
    id: string;
    userId: string;
    role: 'owner' | 'member';
    joinedAt: string;
    user?: {
      id: string;
      email: string;
      fullName?: string | null;
      photoUrl?: string | null;
    };
  }>;
  children: Array<{
    id: string;
    name: string;
    birthDate?: string | null;
    photoUrl?: string | null;
  }>;
  invites: Array<{
    id: string;
    email: string;
    status: 'pending' | 'accepted' | 'rejected';
    invitedById: string;
    invitedByName?: string | null;
    createdAt: string;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class FamilyService {
  private readonly firestore = inject(Firestore);
  private readonly userProfileService = inject(UserProfileService);
  private readonly apiService = inject(ApiService);

  // ==================== PUBLIC API ====================

  listenToFamily(familyId: string): Observable<Family | null> {
    if (useServerBackend()) {
      // Server mode: fetch from API (no real-time yet, but data is correct)
      return new Observable<Family | null>(observer => {
        this.getFamilyMetaServer(familyId)
          .then(family => {
            observer.next(family);
          })
          .catch(err => {
            console.error('[Family] Failed to load family', err);
            observer.next(null);
          });
      });
    }
    
    // Firebase mode: use Firestore real-time
    const ref = doc(this.firestore, 'families', familyId);
    return docData(ref, { idField: 'id' }).pipe(
      map(snapshot => snapshot as Family),
      catchError(() => of(null))
    );
  }

  async ensureFamilyForUser(profile: UserProfile): Promise<string> {
    if (useServerBackend()) {
      return this.ensureFamilyForUserServer(profile);
    }
    return this.ensureFamilyForUserFirebase(profile);
  }

  async inviteCoParent(familyId: string, rawEmail: string, inviter: UserProfile): Promise<void> {
    if (useServerBackend()) {
      return this.inviteCoParentServer(familyId, rawEmail, inviter);
    }
    return this.inviteCoParentFirebase(familyId, rawEmail, inviter);
  }

  async acceptInviteByEmail(rawEmail: string, uid: string, makeActive = false): Promise<string | null> {
    if (useServerBackend()) {
      return this.acceptInviteByEmailServer(rawEmail, uid, makeActive);
    }
    return this.acceptInviteByEmailFirebase(rawEmail, uid, makeActive);
  }

  async joinFamilyByCode(shareCode: string, uid: string, makeActive = false): Promise<string> {
    if (useServerBackend()) {
      return this.joinFamilyByCodeServer(shareCode, uid, makeActive);
    }
    return this.joinFamilyByCodeFirebase(shareCode, uid, makeActive);
  }

  async listFamiliesForUser(uid: string): Promise<Family[]> {
    if (useServerBackend()) {
      return this.listFamiliesForUserServer(uid);
    }
    return this.listFamiliesForUserFirebase(uid);
  }

  async getMemberProfiles(memberIds: string[]): Promise<UserProfile[]> {
    // For now, keep using Firebase for member profiles
    return this.getMemberProfilesFirebase(memberIds);
  }

  async getFamilyMeta(familyId: string): Promise<Family | null> {
    if (useServerBackend()) {
      return this.getFamilyMetaServer(familyId);
    }
    return this.getFamilyMetaFirebase(familyId);
  }

  async generateShareCode(familyId: string): Promise<string> {
    if (useServerBackend()) {
      return this.generateShareCodeServer(familyId);
    }
    return this.generateShareCodeFirebase(familyId);
  }

  async leaveFamily(familyId: string, uid: string): Promise<void> {
    if (useServerBackend()) {
      return this.leaveFamilyServer(familyId, uid);
    }
    return this.leaveFamilyFirebase(familyId, uid);
  }

  async updateFamilyMeta(
    familyId: string,
    payload: { name?: string; children?: string[]; photoUrl?: string | null }
  ): Promise<void> {
    if (useServerBackend()) {
      return this.updateFamilyMetaServer(familyId, payload);
    }
    return this.updateFamilyMetaFirebase(familyId, payload);
  }

  // ==================== SERVER BACKEND METHODS ====================

  private async ensureFamilyForUserServer(profile: UserProfile): Promise<string> {
    // Check if user already has families
    const families = await this.apiService.get<ServerFamily[]>('/users/me/families').toPromise();
    
    if (families && families.length > 0) {
      const familyId = families[0].id;
      await firstValueFrom(this.userProfileService.addFamily(profile.uid, familyId, true));
      return familyId;
    }

    // Create new family
    const newFamily = await this.apiService.post<ServerFamily>('/families', {
      name: `משפחת ${profile.fullName || profile.email}`
    }).toPromise();

    await firstValueFrom(this.userProfileService.addFamily(profile.uid, newFamily!.id, true));
    await firstValueFrom(
      this.userProfileService.updateProfile(profile.uid, {
        ownedFamilyId: newFamily!.id,
        activeFamilyId: newFamily!.id
      })
    );

    return newFamily!.id;
  }

  private async inviteCoParentServer(familyId: string, rawEmail: string, inviter: UserProfile): Promise<void> {
    const normalizedEmail = rawEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      throw new Error('missing-email');
    }

    if (normalizedEmail === inviter.email.toLowerCase()) {
      throw new Error('self-invite');
    }

    await this.apiService.post(`/families/${familyId}/invite`, {
      email: normalizedEmail,
      invitedByName: inviter.fullName || inviter.email
    }).toPromise();
  }

  private async acceptInviteByEmailServer(rawEmail: string, uid: string, makeActive: boolean): Promise<string | null> {
    try {
      const result = await this.apiService.post<{ familyId: string }>('/families/accept-invite', {
        email: rawEmail.trim().toLowerCase()
      }).toPromise();

      if (result?.familyId) {
        await firstValueFrom(this.userProfileService.addFamily(uid, result.familyId, makeActive));
        return result.familyId;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async joinFamilyByCodeServer(shareCode: string, uid: string, makeActive: boolean): Promise<string> {
    const normalizedCode = shareCode.trim();

    if (!normalizedCode) {
      throw new Error('missing-family-code');
    }

    const result = await this.apiService.post<{ id: string }>('/families/join', {
      shareCode: normalizedCode
    }).toPromise();

    if (!result?.id) {
      throw new Error('family-code-not-found');
    }

    await firstValueFrom(this.userProfileService.addFamily(uid, result.id, makeActive || true));
    return result.id;
  }

  private async listFamiliesForUserServer(uid: string): Promise<Family[]> {
    const families = await this.apiService.get<ServerFamily[]>('/users/me/families').toPromise();
    return (families || []).map(f => this.mapServerFamily(f));
  }

  private async getFamilyMetaServer(familyId: string): Promise<Family | null> {
    try {
      const family = await this.apiService.get<ServerFamily>(`/families/${familyId}`).toPromise();
      return family ? this.mapServerFamily(family) : null;
    } catch {
      return null;
    }
  }

  private async generateShareCodeServer(familyId: string): Promise<string> {
    const result = await this.apiService.post<{ shareCode: string }>(`/families/${familyId}/regenerate-code`, {}).toPromise();
    return result!.shareCode;
  }

  private async leaveFamilyServer(familyId: string, uid: string): Promise<void> {
    await this.apiService.post(`/families/${familyId}/leave`, {}).toPromise();
    await firstValueFrom(this.userProfileService.removeFamily(uid, familyId));
  }

  private async updateFamilyMetaServer(
    familyId: string,
    payload: { name?: string; children?: string[]; photoUrl?: string | null }
  ): Promise<void> {
    await this.apiService.patch(`/families/${familyId}`, payload).toPromise();
  }

  private mapServerFamily(data: ServerFamily): Family {
    const members = data.members || [];
    const children = data.children || [];
    const invites = data.invites || [];
    
    return {
      id: data.id,
      name: data.name || undefined,
      ownerId: data.ownerId,
      shareCode: data.shareCode,
      photoUrl: data.photoUrl || undefined,
      members: members.map(m => m.userId),
      children: children.map(c => c.name),
      pendingInvites: invites
        .filter(i => i.status === 'pending')
        .map(i => ({
          email: i.email,
          displayEmail: i.email,
          invitedBy: i.invitedById,
          invitedByName: i.invitedByName || undefined,
          status: 'pending' as const,
          createdAt: new Date(i.createdAt).getTime()
        })),
      pendingInviteEmails: invites
        .filter(i => i.status === 'pending')
        .map(i => i.email)
    };
  }

  // ==================== FIREBASE BACKEND METHODS ====================

  private async ensureFamilyForUserFirebase(profile: UserProfile): Promise<string> {
    const ownedFamilyId = profile.ownedFamilyId || profile.activeFamilyId || (profile as any)['familyId'] || null;

    if (ownedFamilyId) {
      const existingRef = doc(this.firestore, 'families', ownedFamilyId);
      const existingSnap = await getDoc(existingRef);

      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as Family;
        const members = new Set(existingData.members ?? []);
        if (!members.has(profile.uid)) {
          members.add(profile.uid);
          await updateDoc(existingRef, {
            members: Array.from(members),
            ...(existingData.ownerId ? {} : { ownerId: existingData.ownerId ?? profile.uid }),
            updatedAt: serverTimestamp()
          });
        }

        if (!existingData.shareCode) {
          const regeneratedCode = await this.createUniqueShareCode(ownedFamilyId);
          await updateDoc(existingRef, {
            shareCode: regeneratedCode,
            shareCodeUpdatedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }

        await firstValueFrom(this.userProfileService.addFamily(profile.uid, ownedFamilyId, true));
        await firstValueFrom(
          this.userProfileService.updateProfile(profile.uid, {
            ownedFamilyId,
            activeFamilyId: ownedFamilyId
          })
        );
        await this.ensureMembersHaveFamilyList(Array.from(members), ownedFamilyId, profile.uid);

        return ownedFamilyId;
      }
    }

    const familyRef = doc(collection(this.firestore, 'families'));
    const shareCode = await this.createUniqueShareCode(familyRef.id);

    await setDoc(familyRef, {
      ownerId: profile.uid,
      members: [profile.uid],
      pendingInvites: [],
      pendingInviteEmails: [],
      shareCode,
      shareCodeUpdatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await firstValueFrom(this.userProfileService.addFamily(profile.uid, familyRef.id, true));
    await firstValueFrom(
      this.userProfileService.updateProfile(profile.uid, {
        ownedFamilyId: familyRef.id,
        activeFamilyId: familyRef.id
      })
    );

    return familyRef.id;
  }

  private async inviteCoParentFirebase(familyId: string, rawEmail: string, inviter: UserProfile): Promise<void> {
    const normalizedEmail = rawEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      throw new Error('missing-email');
    }

    if (normalizedEmail === inviter.email.toLowerCase()) {
      throw new Error('self-invite');
    }

    const familyRef = doc(this.firestore, 'families', familyId);
    const snapshot = await getDoc(familyRef);

    if (!snapshot.exists()) {
      await setDoc(
        familyRef,
        {
          members: [inviter.uid],
          pendingInvites: [],
          pendingInviteEmails: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    const data = snapshot.data() as Family | undefined;
    if ((data?.members?.length ?? 0) >= 2) {
      throw new Error('family-full');
    }
    const pendingInviteEmails = data?.pendingInviteEmails ?? [];

    if (pendingInviteEmails.includes(normalizedEmail)) {
      throw new Error('existing-invite');
    }

    const invite: FamilyInvite = {
      email: normalizedEmail,
      displayEmail: rawEmail.trim(),
      invitedBy: inviter.uid,
      invitedByName: inviter.fullName || inviter.email,
      status: 'pending',
      createdAt: Date.now()
    };

    const nextInvites = [...(data?.pendingInvites ?? []), invite];
    const nextInviteEmails = [...pendingInviteEmails, normalizedEmail];

    await updateDoc(familyRef, {
      pendingInvites: nextInvites,
      pendingInviteEmails: nextInviteEmails,
      updatedAt: serverTimestamp()
    });
  }

  private async acceptInviteByEmailFirebase(rawEmail: string, uid: string, makeActive: boolean): Promise<string | null> {
    const normalizedEmail = rawEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      return null;
    }

    const familiesRef = collection(this.firestore, 'families');
    const inviteQuery = query(familiesRef, where('pendingInviteEmails', 'array-contains', normalizedEmail), limit(1));
    const snapshot = await getDocs(inviteQuery);

    if (snapshot.empty) {
      return null;
    }

    const familyDoc = snapshot.docs[0];
    const familyId = familyDoc.id;
    const data = familyDoc.data() as Family;

    const members = Array.from(new Set([...(data.members ?? []), uid]));
    if (members.length > 2) {
      throw new Error('family-full');
    }
    const pendingInviteEmails = (data.pendingInviteEmails ?? []).filter(email => email !== normalizedEmail);
    const pendingInvites = (data.pendingInvites ?? []).filter(invite => invite.email !== normalizedEmail);

    await updateDoc(doc(this.firestore, 'families', familyId), {
      members,
      pendingInviteEmails,
      pendingInvites,
      updatedAt: serverTimestamp()
    });

    await firstValueFrom(this.userProfileService.addFamily(uid, familyId, makeActive));
    await this.ensureMembersHaveFamilyList(members, familyId, uid);

    return familyId;
  }

  private async joinFamilyByCodeFirebase(shareCode: string, uid: string, makeActive: boolean): Promise<string> {
    const normalizedCode = shareCode.trim();

    if (!normalizedCode) {
      throw new Error('missing-family-code');
    }

    const familiesRef = collection(this.firestore, 'families');
    const snapshot = await getDocs(query(familiesRef, where('shareCode', '==', normalizedCode), limit(1)));

    if (snapshot.empty) {
      throw new Error('family-code-not-found');
    }

    const familyDoc = snapshot.docs[0];
    const familyId = familyDoc.id;
    const data = familyDoc.data() as Family;

    if ((data.members?.length ?? 0) >= 2 && !(data.members || []).includes(uid)) {
      throw new Error('family-full');
    }

    const members = Array.from(new Set([...(data.members ?? []), uid]));

    await updateDoc(doc(this.firestore, 'families', familyId), {
      members,
      updatedAt: serverTimestamp()
    });

    await firstValueFrom(this.userProfileService.addFamily(uid, familyId, makeActive || true));
    await this.ensureMembersHaveFamilyList(members, familyId, uid);

    return familyId;
  }

  private async listFamiliesForUserFirebase(uid: string): Promise<Family[]> {
    const familiesRef = collection(this.firestore, 'families');
    const snapshot = await getDocs(query(familiesRef, where('members', 'array-contains', uid)));

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data() as Family;
      return { ...data, id: docSnap.id };
    });
  }

  private async getMemberProfilesFirebase(memberIds: string[]): Promise<UserProfile[]> {
    const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)));
    if (!uniqueIds.length) {
      return [];
    }

    const profiles: UserProfile[] = [];
    for (const uid of uniqueIds) {
      try {
        const snap = await getDoc(doc(this.firestore, 'users', uid));
        if (snap.exists()) {
          profiles.push({ ...(snap.data() as UserProfile), uid });
        }
      } catch (error) {
        console.error('Failed to fetch member profile', uid, error);
      }
    }
    return profiles;
  }

  private async getFamilyMetaFirebase(familyId: string): Promise<Family | null> {
    const ref = doc(this.firestore, 'families', familyId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as Family)
    };
  }

  private async generateShareCodeFirebase(familyId: string): Promise<string> {
    const familyRef = doc(this.firestore, 'families', familyId);
    const snapshot = await getDoc(familyRef);

    if (!snapshot.exists()) {
      throw new Error('family-not-found');
    }

    const newCode = await this.createUniqueShareCode(familyId);

    await updateDoc(familyRef, {
      shareCode: newCode,
      shareCodeUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return newCode;
  }

  private async leaveFamilyFirebase(familyId: string, uid: string): Promise<void> {
    if (!familyId || !uid) {
      return;
    }

    const familyRef = doc(this.firestore, 'families', familyId);
    const snapshot = await getDoc(familyRef);

    if (snapshot.exists()) {
      const data = snapshot.data() as Family;
      const members = (data.members ?? []).filter(member => member !== uid);
      await updateDoc(familyRef, {
        members,
        updatedAt: serverTimestamp()
      });
    }

    await firstValueFrom(this.userProfileService.removeFamily(uid, familyId));
  }

  private async updateFamilyMetaFirebase(
    familyId: string,
    payload: { name?: string; children?: string[]; photoUrl?: string | null }
  ): Promise<void> {
    if (!familyId) {
      throw new Error('missing-family-id');
    }
    const familyRef = doc(this.firestore, 'families', familyId);
    const next: Record<string, any> = {
      updatedAt: serverTimestamp()
    };

    if (typeof payload.name === 'string') {
      next['name'] = payload.name.trim();
    }
    if (Array.isArray(payload.children)) {
      next['children'] = payload.children;
    }
    if (payload.photoUrl !== undefined) {
      next['photoUrl'] = payload.photoUrl;
    }

    await updateDoc(familyRef, next);
  }

  private async ensureMembersHaveFamilyList(memberIds: string[], familyId: string, ownerId: string): Promise<void> {
    const targets = (memberIds || []).filter(member => member && member !== ownerId);
    if (!targets.length) {
      return;
    }
    await Promise.all(
      targets.map(member =>
        firstValueFrom(this.userProfileService.addFamily(member, familyId)).catch(error => {
          console.warn('[Family] Failed to ensure family list for user', member, error);
        })
      )
    );
  }

  // ==================== UTILITIES ====================

  private async createUniqueShareCode(currentFamilyId?: string): Promise<string> {
    const familiesRef = collection(this.firestore, 'families');

    for (let i = 0; i < 5; i++) {
      const code = this.generateShareCodeValue();
      const snapshot = await getDocs(query(familiesRef, where('shareCode', '==', code), limit(1)));

      if (snapshot.empty || snapshot.docs[0].id === currentFamilyId) {
        return code;
      }
    }

    throw new Error('share-code-generation-failed');
  }

  private generateShareCodeValue(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
