import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, Subject, Subscription, of, firstValueFrom } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FamilyService } from '../../core/services/family.service';
import { UserProfile } from '../../core/models/user-profile.model';
import { Family, FamilyInvite } from '../../core/models/family.model';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false
})
export class ProfilePage implements OnInit, OnDestroy {
  inviteForm: FormGroup;
  familyCodeForm: FormGroup;
  isInviting = false;
  inviteMessage: { type: 'success' | 'error'; text: string } | null = null;
  shareCode: string | null = null;
  isGeneratingShareCode = false;
  shareCodeCopied = false;
  shareCodeError: string | null = null;
  joinCodeMessage: { type: 'success' | 'error'; text: string } | null = null;
  isJoiningByCode = false;
  isSigningOut = false;
  signOutError: string | null = null;
  familiesList: string[] = [];
  switchingFamilyId: string | null = null;

  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  readonly profile$ = this.profileSubject.asObservable();

  private readonly familySubject = new BehaviorSubject<Family | null>(null);
  readonly family$ = this.familySubject.asObservable();

  private destroy$ = new Subject<void>();
  private familySubscription?: Subscription;
  private lastAuthUser: { uid: string; email: string | null; displayName: string | null } | null = null;

  constructor(
    private authService: AuthService,
    private userProfileService: UserProfileService,
    private familyService: FamilyService,
    private formBuilder: FormBuilder,
    private router: Router
  ) {
    this.inviteForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]]
    });
    this.familyCodeForm = this.formBuilder.group({
      code: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit() {
    this.observeProfile();
  }

  private observeProfile() {
    this.authService.user$
      .pipe(
        takeUntil(this.destroy$),
        switchMap(user => {
          if (!user) {
            this.lastAuthUser = null;
            return of(null);
          }

          this.lastAuthUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName
          };

          return this.userProfileService.listenToProfile(user.uid);
        })
      )
      .subscribe(profile => {
        if (!profile && this.lastAuthUser?.email) {
          this.userProfileService
            .createProfile({
              uid: this.lastAuthUser.uid,
              email: this.lastAuthUser.email,
              fullName: this.lastAuthUser.displayName ?? this.lastAuthUser.email,
              phone: null
            })
            .subscribe();
          return;
        }

        this.profileSubject.next(profile);
        const fallbackFamilyId = profile?.activeFamilyId || (profile as any)?.familyId || null;
        this.familiesList = profile?.families ?? (fallbackFamilyId ? [fallbackFamilyId] : []);

        if (profile && !profile.activeFamilyId && fallbackFamilyId) {
          this.userProfileService.setActiveFamily(profile.uid, fallbackFamilyId).subscribe();
          return;
        }

        if (profile?.activeFamilyId) {
          this.subscribeToFamily(profile.activeFamilyId);
        } else if (fallbackFamilyId) {
          this.subscribeToFamily(fallbackFamilyId);
        } else {
          this.unsubscribeFromFamily();
          this.familySubject.next(null);
          this.shareCode = null;
        }
      });
  }

  private subscribeToFamily(familyId: string) {
    if (this.familySubscription) {
      this.familySubscription.unsubscribe();
    }

    this.familySubscription = this.familyService.listenToFamily(familyId).subscribe(family => {
      this.familySubject.next(family);
      this.updateShareCode(family);
    });
  }

  private unsubscribeFromFamily() {
    if (this.familySubscription) {
      this.familySubscription.unsubscribe();
      this.familySubscription = undefined;
    }
  }

  private updateShareCode(family: Family | null) {
    this.shareCode = family?.shareCode ?? null;
  }



  trackInvite(_: number, invite: FamilyInvite) {
    return invite.email;
  }

  async createFamilySpace() {
    if (this.isGeneratingShareCode) {
      return;
    }

    const profile = this.profileSubject.value;

    if (!profile) {
      return;
    }

    if (profile.activeFamilyId) {
      await this.regenerateShareCode();
      return;
    }

    this.isGeneratingShareCode = true;
    this.shareCodeError = null;

    try {
      const familyId = await this.familyService.ensureFamilyForUser(profile);
      const updatedProfile: UserProfile = {
        ...profile,
        activeFamilyId: familyId,
        families: Array.from(new Set([...(profile.families ?? []), familyId]))
      };
      this.profileSubject.next(updatedProfile);
      this.subscribeToFamily(familyId);
    } catch (error) {
      console.error(error);
      this.shareCodeError = 'לא הצלחנו להכין שיתוף. נסו שוב בעוד רגע.';
    } finally {
      this.isGeneratingShareCode = false;
    }
  }

  async copyShareCode() {
    if (!this.shareCode) {
      return;
    }

    this.shareCodeError = null;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.shareCode);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = this.shareCode;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } else {
        throw new Error('clipboard-not-available');
      }

      this.shareCodeCopied = true;
      setTimeout(() => (this.shareCodeCopied = false), 2000);
    } catch (error) {
      console.error(error);
      this.shareCodeError = 'העתקה נכשלה. נסו לסמן ולהעתיק ידנית.';
    }
  }

  async regenerateShareCode() {
    const profile = this.profileSubject.value;
    if (!profile?.activeFamilyId) {
      this.shareCodeError = 'אין משפחה פעילה לשיתוף.';
      return;
    }

    this.isGeneratingShareCode = true;
    this.shareCodeError = null;

    try {
      const code = await this.familyService.generateShareCode(profile.activeFamilyId);
      this.shareCode = code;
      this.shareCodeCopied = false;
    } catch (error: any) {
      console.error(error);
      if (error?.message === 'family-not-found') {
        try {
          const familyId = await this.familyService.ensureFamilyForUser({
            ...profile,
            activeFamilyId: null
          });
          const updatedProfile: UserProfile = {
            ...profile,
            activeFamilyId: familyId,
            families: Array.from(new Set([...(profile.families ?? []), familyId]))
          };
          this.profileSubject.next(updatedProfile);
          this.subscribeToFamily(familyId);
          this.shareCodeError = null;
        } catch (creationError) {
          console.error(creationError);
          this.shareCodeError = 'לא נמצאה משפחה קיימת ונכשלנו ביצירת חדשה.';
        }
      } else {
        this.shareCodeError = 'יצירת קוד חדש נכשלה. נסו שוב.';
      }
    } finally {
      this.isGeneratingShareCode = false;
    }
  }

  async joinByCode() {
    if (this.familyCodeForm.invalid) {
      this.familyCodeForm.markAllAsTouched();
      return;
    }

    const profile = this.profileSubject.value;

    if (!profile || !this.lastAuthUser?.uid) {
      return;
    }

    this.isJoiningByCode = true;
    this.joinCodeMessage = null;

    const code = (this.familyCodeForm.value.code as string).trim();

    const makeActive = !profile.activeFamilyId;

    try {
      await this.familyService.joinFamilyByCode(code, profile.uid, makeActive);
      this.joinCodeMessage = { type: 'success', text: 'הצטרפת בהצלחה למקור נתונים נוסף' };
      this.familyCodeForm.reset();
    } catch (error: any) {
      let text = 'קוד ההצטרפות אינו תקין';
      if (error?.message === 'family-code-not-found') {
        text = 'לא נמצא מקור נתונים עם הקוד הזה';
      } else if (error?.message === 'missing-family-code') {
        text = 'נא להזין קוד תקין';
      }
      this.joinCodeMessage = { type: 'error', text };
    } finally {
      this.isJoiningByCode = false;
    }
  }

  async setActiveFamily(familyId: string) {
    const profile = this.profileSubject.value;
    if (!profile || profile.activeFamilyId === familyId) {
      return;
    }

    this.switchingFamilyId = familyId;

    try {
      await firstValueFrom(this.userProfileService.setActiveFamily(profile.uid, familyId));
    } catch (error) {
      console.error(error);
    } finally {
      this.switchingFamilyId = null;
    }
  }

  async signOut() {
    if (this.isSigningOut) {
      return;
    }

    this.isSigningOut = true;
    this.signOutError = null;

    try {
      await firstValueFrom(this.authService.logout());
      await this.router.navigate(['/login']);
    } catch (error) {
      console.error(error);
      this.signOutError = 'יציאה נכשלה. נסו שוב בעוד רגע.';
    } finally {
      this.isSigningOut = false;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.unsubscribeFromFamily();
  }
}
