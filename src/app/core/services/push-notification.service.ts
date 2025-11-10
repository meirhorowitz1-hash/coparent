import { Injectable, inject } from '@angular/core';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { ToastController } from '@ionic/angular';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { UserProfileService } from './user-profile.service';

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  private readonly messaging = inject(Messaging, { optional: true });
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly toastCtrl = inject(ToastController);

  private currentUserId: string | null = null;
  private registering = false;
  private initialized = false;

  constructor() {
    if (!this.isPushSupported()) {
      return;
    }

    this.authService.user$.subscribe(async user => {
      this.currentUserId = user?.uid ?? null;
      if (user) {
        await this.ensureRegistration();
      }
    });

    if (this.messaging) {
      onMessage(this.messaging, payload => {
        this.presentForegroundToast(
          payload.notification?.title || 'CoParent',
          payload.notification?.body || ''
        );
      });
    }
  }

  init(): void {
    if (this.initialized || !this.isPushSupported()) {
      return;
    }
    this.initialized = true;
    this.ensureRegistration();
  }

  private isPushSupported(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    const hasNotificationApi = 'Notification' in window;
    const hasServiceWorker = 'serviceWorker' in navigator;
    return (hasNotificationApi && hasServiceWorker) && !!this.messaging;
  }

  private async ensureRegistration(): Promise<void> {
    console.debug('[PushNotificationService] ensureRegistration start', {
      hasUser: !!this.currentUserId,
      registering: this.registering,
      supported: this.isPushSupported()
    });

    if (!this.messaging || !this.currentUserId || this.registering || !this.isPushSupported()) {
      return;
    }

    if (typeof Notification === 'undefined') {
      return;
    }

    if (!environment.firebase.vapidKey) {
      console.warn('[PushNotificationService] Missing Web Push VAPID key');
      return;
    }

    if (Notification.permission === 'default') {
      console.debug('[PushNotificationService] requesting Notification permission');
      await Notification.requestPermission();
    }

    console.debug('[PushNotificationService] permission state', Notification.permission);

    if (Notification.permission !== 'granted') {
      console.warn('[PushNotificationService] permission not granted');
      return;
    }

    try {
      this.registering = true;
      const registration = await this.ensureServiceWorkerRegistered();
      if (!registration) {
        console.warn('[PushNotificationService] service worker registration unavailable');
        return;
      }

      console.debug('[PushNotificationService] service worker ready', {
        scope: registration.scope,
        active: !!registration.active,
        installing: !!registration.installing,
        waiting: !!registration.waiting
      });

      const token = await getToken(this.messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: registration
      });

      console.debug('[PushNotificationService] retrieved token', token ? token.substring(0, 10) + '...' : 'none');

      if (token) {
        await this.userProfileService.addPushToken(this.currentUserId, token);
        console.info('[PushNotificationService] token saved for user', this.currentUserId);
      }
    } catch (error) {
      console.error('[PushNotificationService] Failed to register token', error);
    } finally {
      this.registering = false;
    }
  }

  private async ensureServiceWorkerRegistered(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return null;
    }

    let registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (registration) {
      return registration;
    }

    try {
      console.debug('[PushNotificationService] registering firebase-messaging service worker');
      registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      await navigator.serviceWorker.ready;
      return registration;
    } catch (error) {
      console.error('[PushNotificationService] service worker registration failed', error);
      return null;
    }
  }

  private async presentForegroundToast(title: string, message: string) {
    if (!message) {
      return;
    }

    const toast = await this.toastCtrl.create({
      header: title,
      message,
      duration: 4000,
      position: 'top',
      buttons: [{ text: 'סגור', role: 'cancel' }]
    });

    await toast.present();
  }
}
