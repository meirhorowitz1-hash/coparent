import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { PushNotificationService } from './core/services/push-notification.service';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonicModule, RouterModule],
})
export class AppComponent {
  constructor(private pushNotificationService: PushNotificationService) {
    this.pushNotificationService.init();
  }
}
