import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, Subject, Subscription, of, firstValueFrom } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FamilyService } from '../../core/services/family.service';
import { CalendarService } from '../../core/services/calendar.service';
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
  isShareOwner = false;
  isLeavingFamily = false;
  leaveFamilyMessage: { type: 'success' | 'error'; text: string } | null = null;
  joinCodeMessage: { type: 'success' | 'error'; text: string } | null = null;
  isJoiningByCode = false;
  isSigningOut = false;
  signOutError: string | null = null;
  familiesList: string[] = [];
  switchingFamilyId: string | null = null;
  leavingFamilyId: string | null = null;
  familyOptions: { id: string; name: string }[] = [];
  isLoadingFamilyOptions = false;
  householdForm: FormGroup;
  householdChildren: string[] = [];
  isSavingHousehold = false;
  isEditingFamilyMeta = false;
  showMembersAccordion = false;
  memberNames: string[] = [];
  profileEditForm: FormGroup;
  isEditingProfile = false;
  isSavingProfile = false;
  parentLabels = { parent1: 'הורה 1', parent2: 'הורה 2' };
  readonly parentColors = { parent1: 'var(--ion-color-secondary)', parent2: 'var(--ion-color-primary)' };

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
    private calendarService: CalendarService,
    private formBuilder: FormBuilder,
    private router: Router
  ) {
    this.inviteForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]]
    });
    this.familyCodeForm = this.formBuilder.group({
      code: ['', [Validators.required, Validators.minLength(6)]]
    });
    this.householdForm = this.formBuilder.group({
      name: ['', [Validators.minLength(2)]],
      childName: ['']
    });
    this.householdForm.disable({ emitEvent: false });
    this.profileEditForm = this.formBuilder.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      photoUrl: ['']
    });
  }

  ngOnInit() {
    this.observeProfile();
    this.observeParentMetadata();
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
        this.refreshFamilyOptions(profile, fallbackFamilyId);
        this.profileEditForm.patchValue({
          fullName: profile?.fullName || '',
          photoUrl: profile?.photoUrl || ''
        });

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

  private observeParentMetadata() {
    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentLabels = {
          parent1: metadata.parent1.name || 'הורה 1',
          parent2: metadata.parent2.name || 'הורה 2'
        };
      });
  }

  private subscribeToFamily(familyId: string) {
    if (this.familySubscription) {
      this.familySubscription.unsubscribe();
    }

    this.familySubscription = this.familyService.listenToFamily(familyId).subscribe(family => {
      this.familySubject.next(family);
      this.updateShareCode(family);
      this.householdChildren = [...(family?.children ?? [])];
      this.householdForm.patchValue({
        name: family?.name || '',
        childName: ''
      });
      if (!this.isEditingFamilyMeta) {
        this.householdForm.disable({ emitEvent: false });
      }
      this.loadMemberNames(family?.members ?? []);
      const profile = this.profileSubject.value;
      this.isShareOwner = !!(profile?.ownedFamilyId && family?.id === profile.ownedFamilyId);
    });
  }

  private unsubscribeFromFamily() {
    if (this.familySubscription) {
      this.familySubscription.unsubscribe();
      this.familySubscription = undefined;
    }
    this.isShareOwner = false;
  }

  private updateShareCode(family: Family | null) {
    this.shareCode = family?.shareCode ?? null;
  }

  private async loadMemberNames(memberIds: string[]) {
    if (!memberIds?.length) {
      this.memberNames = [];
      return;
    }

    try {
      const profiles = await this.familyService.getMemberProfiles(memberIds);
      this.memberNames = profiles.map(profile =>
        profile.fullName || (profile as any)?.displayName || profile.email || 'הורה'
      );
    } catch (error) {
      console.error('Failed to load member names', error);
      this.memberNames = [];
    }
  }

  private async refreshFamilyOptions(profile: UserProfile | null, fallbackFamilyId?: string | null) {
    if (!profile?.uid) {
      this.familyOptions = [];
      this.familiesList = [];
      return;
    }

    this.isLoadingFamilyOptions = true;

    try {
      const familiesFromQuery = await this.familyService.listFamiliesForUser(profile.uid);
      const idsFromQuery = familiesFromQuery.map(f => f.id!).filter(Boolean);
      const mergedIds = Array.from(
        new Set([
          ...(profile.families ?? []),
          ...idsFromQuery,
          fallbackFamilyId || null,
          profile.activeFamilyId || null
        ].filter(Boolean) as string[])
      );

      this.familiesList = mergedIds;
      this.familyOptions = mergedIds.map(id => {
        const found = familiesFromQuery.find(f => f.id === id);
        return { id, name: found?.name || 'מרחב ללא שם' };
      });
    } finally {
      this.isLoadingFamilyOptions = false;
    }
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
      this.refreshFamilyOptions(updatedProfile, familyId);
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

  addChild() {
    if (!this.isEditingFamilyMeta) {
      return;
    }
    const child = (this.householdForm.value.childName as string)?.trim();
    if (!child) {
      return;
    }
    this.householdChildren = [...this.householdChildren, child];
    this.householdForm.patchValue({ childName: '' });
  }

  removeChild(name: string) {
    if (!this.isEditingFamilyMeta) {
      return;
    }
    this.householdChildren = this.householdChildren.filter(c => c !== name);
  }

  startProfileEdit() {
    this.isEditingProfile = true;
  }

  cancelProfileEdit() {
    const profile = this.profileSubject.value;
    this.profileEditForm.patchValue({
      fullName: profile?.fullName || '',
      photoUrl: profile?.photoUrl || ''
    });
    this.isEditingProfile = false;
  }

  async saveProfile() {
    const profile = this.profileSubject.value;
    if (!profile) {
      return;
    }

    if (this.profileEditForm.invalid) {
      this.profileEditForm.markAllAsTouched();
      return;
    }

    this.isSavingProfile = true;
    const { fullName, photoUrl } = this.profileEditForm.value;
    try {
      await firstValueFrom(
        this.userProfileService.updateProfile(profile.uid, {
          fullName: (fullName as string).trim(),
          photoUrl: (photoUrl as string)?.trim() || null
        })
      );
      const updated: UserProfile = {
        ...profile,
        fullName: (fullName as string).trim(),
        photoUrl: (photoUrl as string)?.trim() || null
      };
      this.profileSubject.next(updated);
      this.isEditingProfile = false;
    } catch (error) {
      console.error('Failed to save profile', error);
    } finally {
      this.isSavingProfile = false;
    }
  }

  async saveHouseholdMeta() {
    if (!this.isEditingFamilyMeta) {
      return;
    }

    const family = this.familySubject.value;
    if (!family?.id) {
      return;
    }
    const nameCtrl = this.householdForm.get('name');
    if (nameCtrl && nameCtrl.value && nameCtrl.invalid) {
      nameCtrl.markAsTouched();
      return;
    }

    const cleanedChildren = Array.from(
      new Set(
        this.householdChildren
          .map(c => (c || '').trim())
          .filter(Boolean)
      )
    );

    this.isSavingHousehold = true;
    try {
      await this.familyService.updateFamilyMeta(family.id, {
        name: (nameCtrl?.value as string)?.trim() || family.name || 'מרחב משותף',
        children: cleanedChildren
      });
      this.isEditingFamilyMeta = false;
      this.householdForm.disable({ emitEvent: false });
    } catch (error) {
      console.error('Failed to save household meta', error);
    } finally {
      this.isSavingHousehold = false;
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
          this.refreshFamilyOptions(updatedProfile, familyId);
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

  scrollToJoinSection() {
    if (typeof document === 'undefined') {
      return;
    }

    const joinSection = document.getElementById('join-by-code');
    if (joinSection?.scrollIntoView) {
      joinSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  startFamilyEdit() {
    this.isEditingFamilyMeta = true;
    this.householdForm.enable({ emitEvent: false });
  }

  cancelFamilyEdit() {
    const family = this.familySubject.value;
    this.isEditingFamilyMeta = false;
    this.householdForm.disable({ emitEvent: false });
    this.householdChildren = [...(family?.children ?? [])];
    this.householdForm.patchValue({
      name: family?.name || '',
      childName: ''
    });
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

    try {
      const joinedFamilyId = await this.familyService.joinFamilyByCode(code, profile.uid, true);
      await firstValueFrom(this.userProfileService.setActiveFamily(profile.uid, joinedFamilyId));
      this.joinCodeMessage = { type: 'success', text: 'הצטרפת בהצלחה למקור נתונים נוסף' };
      this.familyCodeForm.reset();
    } catch (error: any) {
      let text = 'קוד ההצטרפות אינו תקין';
      if (error?.message === 'family-code-not-found') {
        text = 'לא נמצא מקור נתונים עם הקוד הזה';
      } else if (error?.message === 'missing-family-code') {
        text = 'נא להזין קוד תקין';
      } else if (error?.message === 'family-full') {
        text = 'המשפחה הזו כבר מלאה (2 הורים מחוברים)';
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

  async leaveFamily(familyId?: string) {
    const profile = this.profileSubject.value;
    const family = familyId ? null : this.familySubject.value;
    const targetFamilyId = familyId || family?.id;

    if (!profile?.uid || !targetFamilyId) {
      return;
    }

    if (this.isLeavingFamily) {
      return;
    }

    this.leaveFamilyMessage = null;
    this.isLeavingFamily = true;
    this.leavingFamilyId = targetFamilyId;
    try {
      await this.familyService.leaveFamily(targetFamilyId, profile.uid);
      // Clear local state
      if (!familyId) {
        this.familySubject.next(null);
        this.shareCode = null;
        this.isShareOwner = false;
      }
      const updatedProfile: UserProfile = {
        ...profile,
        activeFamilyId: profile.activeFamilyId === targetFamilyId ? null : profile.activeFamilyId,
        families: (profile.families ?? []).filter(id => id !== targetFamilyId)
      };
      this.profileSubject.next(updatedProfile);
      this.refreshFamilyOptions(updatedProfile);
      this.leaveFamilyMessage = { type: 'success', text: 'התנתקת מהמשפחה' };
    } catch (error) {
      console.error(error);
      this.leaveFamilyMessage = { type: 'error', text: 'לא הצלחנו להתנתק מהמשפחה. נסו שוב.' };
    } finally {
      this.isLeavingFamily = false;
      this.leavingFamilyId = null;
    }
  }

  onLeaveFamilyClick(event: Event, familyId: string) {
    event.stopPropagation();
    this.leaveFamily(familyId);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.unsubscribeFromFamily();
  }
}
