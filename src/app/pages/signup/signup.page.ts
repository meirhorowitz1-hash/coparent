import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { FamilyService } from '../../core/services/family.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
  standalone: false
})
export class SignupPage implements OnInit {
  signupForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  showConfirmPassword = false;
  currentStep = 1;
  totalSteps = 2;
  authError: string | null = null;
  private familyCode: string | null = null;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private userProfileService: UserProfileService,
    private familyService: FamilyService
  ) {}

  ngOnInit() {
    this.initForm();
    this.familyCode = this.route.snapshot.queryParamMap.get('family');
  }

  initForm() {
    this.signupForm = this.formBuilder.group({
      // Step 1 - Personal Info
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.pattern(/^[0-9]{10}$/)]],
      
      // Step 2 - Account Security
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');
    
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      const existingErrors = confirmPassword.errors ?? {};
      confirmPassword.setErrors({ ...existingErrors, passwordMismatch: true });
      return { passwordMismatch: true };
    }

    if (confirmPassword?.errors?.['passwordMismatch']) {
      const { passwordMismatch, ...otherErrors } = confirmPassword.errors;
      if (Object.keys(otherErrors).length) {
        confirmPassword.setErrors(otherErrors);
      } else {
        confirmPassword.setErrors(null);
      }
    }
    
    return null;
  }

  nextStep() {
    // Validate current step fields
    if (this.currentStep === 1) {
      const step1Fields = ['fullName', 'email', 'phone'];
      let isValid = true;
      
      step1Fields.forEach(field => {
        const control = this.signupForm.get(field);
        if (control) {
          control.markAsTouched();
          const isMandatoryInvalid =
            control.invalid && (field === 'fullName' || field === 'email');
          const isPhoneInvalid =
            field === 'phone' && control.value && control.invalid;

          if (isMandatoryInvalid || isPhoneInvalid) {
            isValid = false;
          } 
        }
      });
      
      if (isValid) {
        this.currentStep = 2;
      }
    }
  }

  previousStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  async onSignup() {
    if (this.signupForm.invalid) {
      Object.keys(this.signupForm.controls).forEach(key => {
        this.signupForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isLoading = true;
    this.authError = null;

    const { fullName, email, password, phone } = this.signupForm.value as {
      fullName: string;
      email: string;
      password: string;
      phone?: string;
    };

    try {
      const credential = await firstValueFrom(this.authService.signup(fullName, email, password));
      const user = credential.user;

      if (!user) {
        throw new Error('missing-user');
      }

      await firstValueFrom(
        this.userProfileService.createProfile({
          uid: user.uid,
          fullName,
          email,
          phone: phone ?? null
        })
      );

      let joinedFamilyId: string | null = null;

      if (this.familyCode) {
        joinedFamilyId = await this.familyService.joinFamilyByCode(this.familyCode, user.uid, true);
      } else {
        joinedFamilyId = await this.familyService.acceptInviteByEmail(email, user.uid, true);
      }

      if (!joinedFamilyId) {
        await this.familyService.ensureFamilyForUser({
          uid: user.uid,
          fullName,
          email,
          phone: phone ?? null,
          families: [],
          activeFamilyId: null
        });
      }

      this.isLoading = false;
      this.router.navigate(['/tabs/calendar']);
    } catch (error: any) {
      this.isLoading = false;
      if (error?.message === 'family-not-found') {
        this.authError = 'קישור ההזמנה אינו תקין או שפג תוקפו';
      } else {
        this.authError = this.authService.getFriendlyErrorMessage(error?.code);
      }
    }
  }

  togglePasswordVisibility(field: 'password' | 'confirmPassword') {
    if (field === 'password') {
      this.showPassword = !this.showPassword;
    } else {
      this.showConfirmPassword = !this.showConfirmPassword;
    }
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.signupForm.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.signupForm.get(fieldName);
    
    if (field?.hasError('required')) {
      return 'שדה חובה';
    }
    
    if (field?.hasError('email')) {
      return 'כתובת אימייל לא תקינה';
    }
    
    if (field?.hasError('minlength')) {
      const minLength = field.getError('minlength').requiredLength;
      return `נדרש לפחות ${minLength} תווים`;
    }
    
    if (field?.hasError('pattern')) {
      return 'מספר טלפון לא תקין (10 ספרות)';
    }

    if (field?.hasError('passwordMismatch')) {
      return 'הסיסמאות אינן תואמות';
    }

    if (field?.hasError('requiredTrue')) {
      return 'יש לאשר את תנאי השימוש';
    }
    
    return '';
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}
