import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, serverTimestamp, setDoc, updateDoc, arrayUnion, arrayRemove } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { UserProfile } from '../models/user-profile.model';
import { ApiService } from './api.service';
import { useServerBackend } from './backend-mode';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  private readonly firestore = inject(Firestore);
  private readonly apiService = inject(ApiService);

  listenToProfile(uid: string): Observable<UserProfile | null> {
    const ref = doc(this.firestore, 'users', uid);
    return docData(ref, { idField: 'uid' }).pipe(
      map(snapshot => snapshot as UserProfile),
      tap(profile => {
        // Sync to server when profile loads (if server mode)
        if (profile && useServerBackend()) {
          this.syncUserToServer(profile).catch(err => 
            console.warn('[UserProfile] Server sync failed:', err)
          );
        }
      }),
      catchError(() => of(null))
    );
  }

  createProfile(profile: { uid: string; fullName: string; email: string; phone?: string | null }): Observable<void> {
    const ref = doc(this.firestore, 'users', profile.uid);
    
    // Sync to server
    if (useServerBackend()) {
      this.syncUserToServer({
        uid: profile.uid,
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone || null,
      } as UserProfile).catch(err => 
        console.warn('[UserProfile] Server sync failed:', err)
      );
    }

    return from(
      setDoc(
        ref,
        {
          ...profile,
          phone: profile.phone ?? null,
          families: [],
          ownedFamilyId: null,
          activeFamilyId: null,
          photoUrl: null,
          calendarColor: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )
    );
  }

  updateProfile(uid: string, data: Partial<UserProfile>): Observable<void> {
    const ref = doc(this.firestore, 'users', uid);
    
    // Sync to server
    if (useServerBackend()) {
      this.apiService.patch('/users/me', data).subscribe({
        error: err => console.warn('[UserProfile] Server update failed:', err)
      });
    }

    return from(
      updateDoc(ref, {
        ...data,
        updatedAt: serverTimestamp()
      })
    );
  }

  addFamily(uid: string, familyId: string, makeActive = false): Observable<void> {
    const ref = doc(this.firestore, 'users', uid);
    
    // Sync family membership to server
    if (useServerBackend()) {
      this.syncFamilyMembershipToServer(familyId).catch(err =>
        console.warn('[UserProfile] Family sync failed:', err)
      );
    }

    return from(
      updateDoc(ref, {
        families: arrayUnion(familyId),
        ...(makeActive ? { activeFamilyId: familyId } : {}),
        updatedAt: serverTimestamp()
      })
    );
  }

  removeFamily(uid: string, familyId: string): Observable<void> {
    const ref = doc(this.firestore, 'users', uid);
    return from(
      updateDoc(ref, {
        families: arrayRemove(familyId),
        activeFamilyId: null,
        updatedAt: serverTimestamp()
      })
    );
  }

  setActiveFamily(uid: string, familyId: string | null): Observable<void> {
    const ref = doc(this.firestore, 'users', uid);
    return from(
      updateDoc(ref, {
        activeFamilyId: familyId,
        updatedAt: serverTimestamp()
      })
    );
  }

  async addPushToken(uid: string, token: string): Promise<void> {
    if (!token) {
      return;
    }

    const ref = doc(this.firestore, 'users', uid);
    await updateDoc(ref, {
      pushTokens: arrayUnion(token),
      updatedAt: serverTimestamp()
    });

    // Sync push token to server
    if (useServerBackend()) {
      this.apiService.post('/users/me/push-token', { token }).subscribe({
        error: err => console.warn('[UserProfile] Push token sync failed:', err)
      });
    }
  }

  async removePushTokens(uid: string, tokens: string[]): Promise<void> {
    if (!tokens.length) {
      return;
    }

    const ref = doc(this.firestore, 'users', uid);
    await updateDoc(ref, {
      pushTokens: arrayRemove(...tokens),
      updatedAt: serverTimestamp()
    });
  }

  // ==================== SERVER SYNC METHODS ====================

  /**
   * Sync user to PostgreSQL server
   */
  private async syncUserToServer(profile: UserProfile): Promise<void> {
    try {
      await this.apiService.post('/users/sync', {
        uid: profile.uid,
        email: profile.email,
        fullName: profile.fullName,
        photoUrl: profile.photoUrl,
        phone: profile.phone,
      }).toPromise();
    } catch (error) {
      // Server might not have this endpoint yet, that's ok
      console.debug('[UserProfile] Sync endpoint not available');
    }
  }

  /**
   * Sync family membership to server
   */
  private async syncFamilyMembershipToServer(familyId: string): Promise<void> {
    try {
      await this.apiService.post(`/families/${familyId}/sync-membership`, {}).toPromise();
    } catch (error) {
      // Server will auto-create via middleware, that's ok
      console.debug('[UserProfile] Family sync endpoint not available');
    }
  }
}
