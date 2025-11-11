import { Injectable, inject } from '@angular/core';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { ToastController } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, PushNotificationSchema, Token } from '@capacitor/push-notifications';
import {
  FirebaseMessaging,
  NotificationReceivedEvent,
  TokenReceivedEvent
} from '@capacitor-firebase/messaging';

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
  private readonly isNativePlatform = Capacitor.isNativePlatform();

  private currentUserId: string | null = null;
  private registering = false;
  private initialized = false;
  private nativeListenersRegistered = false;

  constructor() {
    if (this.isNativePlatform) {
      this.registerNativeForegroundHandlers();
    } else if (this.messaging && this.isPushSupported()) {
      onMessage(this.messaging, payload => {
        this.presentForegroundToast(
          payload.notification?.title || 'CoParent',
          payload.notification?.body || ''
        );
      });
    }

    this.authService.user$.subscribe(async user => {
      this.currentUserId = user?.uid ?? null;
      if (user) {
        await this.ensureRegistration();
      }
    });
  }

  init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.ensureRegistration();
  }

  private isPushSupported(): boolean {
    if (this.isNativePlatform) {
      return false;
    }

    if (typeof window === 'undefined') {
      return false;
    }

    const hasNotificationApi = 'Notification' in window;
    const hasServiceWorker = 'serviceWorker' in navigator;
    return (hasNotificationApi && hasServiceWorker) && !!this.messaging;
  }

  private async ensureRegistration(): Promise<void> {
    if (this.isNativePlatform) {
      await this.registerNativePush();
      return;
    }

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

      console.debug(
        '[PushNotificationService] retrieved token',
        token ? token.substring(0, 10) + '...' : 'none'
      );

      if (token) {
        await this.savePushToken(token);
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

  private registerNativeForegroundHandlers() {
    if (this.nativeListenersRegistered || !this.isNativePlatform) {
      return;
    }

    this.nativeListenersRegistered = true;

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      this.presentForegroundToast(
        notification.title || notification.data?.title || 'CoParent',
        notification.body || (notification.data as any)?.body || ''
      );
    });

    PushNotifications.addListener('registration', async (_: Token) => {
      await this.refreshNativeToken();
    });

    PushNotifications.addListener('registrationError', err => {
      console.error('[PushNotificationService] Native registration error', err);
    });

    FirebaseMessaging.addListener('notificationReceived', async (event: NotificationReceivedEvent) => {
      const title = event.notification?.title || 'CoParent';
      const dataPayload = event.notification?.data as Record<string, unknown> | undefined;
      const fallbackBody = typeof dataPayload?.['body'] === 'string' ? (dataPayload['body'] as string) : '';
      const body = event.notification?.body || fallbackBody || '';
      await this.presentForegroundToast(title, body);
    });

    FirebaseMessaging.addListener('tokenReceived', async (event: TokenReceivedEvent) => {
      await this.savePushToken(event.token);
    });
  }

  private async registerNativePush(): Promise<void> {
    if (!this.isNativePlatform || this.registering || !this.currentUserId) {
      return;
    }

    try {
      this.registering = true;
      this.registerNativeForegroundHandlers();

      let permission = await PushNotifications.checkPermissions();
      if (permission.receive !== 'granted') {
        permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') {
          console.warn('[PushNotificationService] Notification permission not granted');
          return;
        }
      }

      let messagingPermission = await FirebaseMessaging.checkPermissions();
      if (messagingPermission.receive !== 'granted') {
        messagingPermission = await FirebaseMessaging.requestPermissions();
        if (messagingPermission.receive !== 'granted') {
          console.warn('[PushNotificationService] Firebase messaging permission not granted');
          return;
        }
      }

      await PushNotifications.register();
      await this.refreshNativeToken();
    } catch (error) {
      console.error('[PushNotificationService] Failed to register native token', error);
    } finally {
      this.registering = false;
    }
  }

  private async refreshNativeToken() {
    try {
      const { token } = await FirebaseMessaging.getToken();
      if (token) {
        await this.savePushToken(token);
        console.info('[PushNotificationService] native token saved for user', this.currentUserId);
      } else {
        console.warn('[PushNotificationService] Native token not available yet');
      }
    } catch (error) {
      console.error('[PushNotificationService] Failed to refresh native token', error);
    }
  }

  private async savePushToken(token: string) {
    if (!this.currentUserId || !token) {
      return;
    }

    await this.userProfileService.addPushToken(this.currentUserId, token);
  }
}
