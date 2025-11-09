import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, serverTimestamp, setDoc, updateDoc, arrayUnion } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { UserProfile } from '../models/user-profile.model';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  private readonly firestore = inject(Firestore);

  listenToProfile(uid: string): Observable<UserProfile | null> {
    const ref = doc(this.firestore, 'users', uid);
    return docData(ref, { idField: 'uid' }).pipe(
      map(snapshot => snapshot as UserProfile),
      catchError(() => of(null))
    );
  }

  createProfile(profile: { uid: string; fullName: string; email: string; phone?: string | null }): Observable<void> {
    const ref = doc(this.firestore, 'users', profile.uid);
    return from(
      setDoc(
        ref,
        {
          ...profile,
          phone: profile.phone ?? null,
          families: [],
          activeFamilyId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )
    );
  }

  updateProfile(uid: string, data: Partial<UserProfile>): Observable<void> {
    const ref = doc(this.firestore, 'users', uid);
    return from(
      updateDoc(ref, {
        ...data,
        updatedAt: serverTimestamp()
      })
    );
  }

  addFamily(uid: string, familyId: string, makeActive = false): Observable<void> {
    const ref = doc(this.firestore, 'users', uid);
    return from(
      updateDoc(ref, {
        families: arrayUnion(familyId),
        ...(makeActive ? { activeFamilyId: familyId } : {}),
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
}
