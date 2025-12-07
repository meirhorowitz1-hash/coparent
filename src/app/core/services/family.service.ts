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

@Injectable({
  providedIn: 'root'
})
export class FamilyService {
  private readonly firestore = inject(Firestore);
  private readonly userProfileService = inject(UserProfileService);

  listenToFamily(familyId: string): Observable<Family | null> {
    const ref = doc(this.firestore, 'families', familyId);
    return docData(ref, { idField: 'id' }).pipe(
      map(snapshot => snapshot as Family),
      catchError(() => of(null))
    );
  }

  async ensureFamilyForUser(profile: UserProfile): Promise<string> {
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

  async inviteCoParent(familyId: string, rawEmail: string, inviter: UserProfile): Promise<void> {
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

  async acceptInviteByEmail(rawEmail: string, uid: string, makeActive = false): Promise<string | null> {
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

    if (members.length > 2) {
      throw new Error('family-full');
    }

    await updateDoc(doc(this.firestore, 'families', familyId), {
      members,
      pendingInviteEmails,
      pendingInvites,
      updatedAt: serverTimestamp()
    });

    await firstValueFrom(this.userProfileService.addFamily(uid, familyId, makeActive));

    return familyId;
  }

  async joinFamilyByCode(shareCode: string, uid: string, makeActive = false): Promise<string> {
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

    return familyId;
  }

  async listFamiliesForUser(uid: string): Promise<Family[]> {
    const familiesRef = collection(this.firestore, 'families');
    const snapshot = await getDocs(query(familiesRef, where('members', 'array-contains', uid)));

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data() as Family;
      return { ...data, id: docSnap.id };
    });
  }

  async getMemberProfiles(memberIds: string[]): Promise<UserProfile[]> {
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

  async getFamilyMeta(familyId: string): Promise<Family | null> {
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

  async generateShareCode(familyId: string): Promise<string> {
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

  async leaveFamily(familyId: string, uid: string): Promise<void> {
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

  async updateFamilyMeta(
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
