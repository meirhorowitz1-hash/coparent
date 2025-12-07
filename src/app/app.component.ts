import { Component, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { PushNotificationService } from './core/services/push-notification.service';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AuthService } from './core/services/auth.service';
import { I18nService } from './core/services/i18n.service';

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
    // Instantiating I18nService sets the initial dir/lang attributes
    private i18nService: I18nService
  ) {
    this.pushNotificationService.init();
    this.configureStatusBar();
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
