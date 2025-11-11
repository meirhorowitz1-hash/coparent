import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.page.html',
  styleUrls: ['./sign-in.page.scss'],
  standalone: false
})
export class SignInPage implements OnInit {
  loginForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  authError: string | null = null;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.initForm();
  }

  initForm() {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [false]
    });
  }

  async onLogin() {
    if (this.loginForm.invalid) {
      Object.keys(this.loginForm.controls).forEach(key => {
        this.loginForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isLoading = true;
    this.authError = null;

    const { email, password } = this.loginForm.value as { email: string; password: string };

    this.authService.login(email, password).pipe(take(1)).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigate(['/shell/home']);
      },
      error: (error) => {
        this.isLoading = false;
        this.authError = this.authService.getFriendlyErrorMessage(error?.code);
      }
    });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.loginForm.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    
    if (field?.hasError('required')) {
      return 'שדה חובה';
    }
    
    if (field?.hasError('email')) {
      return 'כתובת אימייל לא תקינה';
    }
    
    if (field?.hasError('minlength')) {
      return 'הסיסמה חייבת להכיל לפחות 6 תווים';
    }
    
    return '';
  }

  goToSignup() {
    this.router.navigate(['/auth/sign-up']);
  }

  goToForgotPassword() {
    // TODO: Navigate to forgot password page
    console.log('Navigate to forgot password');
  }
}
