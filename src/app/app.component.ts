import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { PushNotificationService } from './core/services/push-notification.service';
import { AuthService } from './core/services/auth.service';
import { StatusBar, Style } from '@capacitor/status-bar';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false
})
export class AppComponent implements OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(
    private pushNotificationService: PushNotificationService,
    private authService: AuthService,
    private router: Router
  ) {
    this.pushNotificationService.init();
    this.handleAuthRedirects();
    this.configureStatusBar();
  }

  private handleAuthRedirects() {
    this.authService.user$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        const url = this.router.url || '';

        if (user) {
          const isAuthRoute = url === '/' || url.startsWith('/login') || url.startsWith('/signup');
          if (isAuthRoute) {
            this.router.navigate(['/tabs/home']);
          }
        } else {
          const isPublicRoute = url.startsWith('/login') || url.startsWith('/signup');
          if (!isPublicRoute) {
            this.router.navigate(['/login']);
          }
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async configureStatusBar() {
    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: Style.Dark });
    } catch (error) {
      // Ignore if not on a native platform
      console.debug('StatusBar configuration skipped', error);
    }
  }
}
