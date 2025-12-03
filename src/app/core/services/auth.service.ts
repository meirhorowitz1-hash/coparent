import { Injectable, inject } from '@angular/core';
import {
  Auth,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  user,
  UserCredential
} from '@angular/fire/auth';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly auth = inject(Auth);
  readonly user$ = user(this.auth);

  login(email: string, password: string): Observable<UserCredential> {
    return from(signInWithEmailAndPassword(this.auth, email, password));
  }

  signup(fullName: string, email: string, password: string): Observable<UserCredential> {
    return from(
      createUserWithEmailAndPassword(this.auth, email, password).then(async credential => {
        if (credential.user && fullName) {
          await updateProfile(credential.user, { displayName: fullName });
        }

        return credential;
      })
    );
  }

  logout(): Observable<void> {
    return from(signOut(this.auth));
  }

  loginWithGoogle(): Observable<UserCredential> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return from(signInWithPopup(this.auth, provider));
  }

  getFriendlyErrorMessage(errorCode?: string): string {
    switch (errorCode) {
      case 'auth/invalid-email':
        return 'כתובת האימייל אינה תקינה';
      case 'auth/user-disabled':
        return 'החשבון נחסם. צור קשר עם התמיכה.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'האימייל או הסיסמה שגויים';
      case 'auth/email-already-in-use':
        return 'האימייל הזה כבר קיים במערכת';
      case 'auth/weak-password':
        return 'הסיסמה חייבת להכיל לפחות 6 תווים';
      case 'auth/network-request-failed':
        return 'בדוק את החיבור לאינטרנט ונסה שוב';
      default:
        return 'אירעה שגיאה בלתי צפויה. נסה שוב מאוחר יותר';
    }
  }
}
