import { NgModule, LOCALE_ID, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { IonicModule } from '@ionic/angular';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideMessaging, getMessaging } from '@angular/fire/messaging';
import { environment } from '../environments/environment';
import { registerLocaleData } from '@angular/common';
import localeHe from '@angular/common/locales/he';

registerLocaleData(localeHe);

const messagingSupported = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  'Notification' in window &&
  'serviceWorker' in navigator;

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    IonicModule.forRoot({ mode: 'ios' }),
    AppRoutingModule
  ],
  providers: [
    { provide: LOCALE_ID, useValue: 'he-IL' },
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    ...(messagingSupported() ? [provideMessaging(() => getMessaging())] : [])
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  bootstrap: [AppComponent]
})
export class AppModule {}
