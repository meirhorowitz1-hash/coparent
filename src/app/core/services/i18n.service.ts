import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { SupportedLanguage, TRANSLATIONS } from '../i18n/translations';

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  private readonly storageKey = 'coparent-lang';
  private readonly supported: SupportedLanguage[] = ['he', 'en'];

  private readonly languageSubject = new BehaviorSubject<SupportedLanguage>(this.getInitialLanguage());
  readonly language$ = this.languageSubject.asObservable();

  constructor(@Inject(DOCUMENT) private document: Document) {
    this.applyDocumentAttributes();
  }

  get currentLanguage(): SupportedLanguage {
    return this.languageSubject.value;
  }

  get direction(): 'rtl' | 'ltr' {
    return this.currentLanguage === 'he' ? 'rtl' : 'ltr';
  }

  get locale(): string {
    return this.currentLanguage === 'he' ? 'he-IL' : 'en-US';
  }

  setLanguage(lang: SupportedLanguage | string | null | undefined) {
    if (!lang || !this.supported.includes(lang as SupportedLanguage)) {
      return;
    }
    const normalized = lang as SupportedLanguage;
    // Re-apply attributes even if the language is the same
    if (normalized !== this.currentLanguage) {
      this.languageSubject.next(normalized);
      try {
        localStorage.setItem(this.storageKey, normalized);
      } catch (err) {
        console.warn('Unable to persist language', err);
      }
    }
    this.applyDocumentAttributes();
  }

  toggleLanguage() {
    this.setLanguage(this.currentLanguage === 'he' ? 'en' : 'he');
  }

  translate(key: string, params?: Record<string, string | number>): string {
    if (!key) {
      return '';
    }
    const fallback = TRANSLATIONS.en[key] || key;
    const value = TRANSLATIONS[this.currentLanguage][key] || fallback;
    return this.interpolate(value, params);
  }

  formatDate(
    dateInput: Date | string | number,
    options: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }
  ): string {
    const date = this.coerceDate(dateInput);
    return new Intl.DateTimeFormat(this.locale, options).format(date);
  }

  formatTime(dateInput: Date | string | number, options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }) {
    const date = this.coerceDate(dateInput);
    return new Intl.DateTimeFormat(this.locale, options).format(date);
  }

  private interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) {
      return template;
    }
    return Object.keys(params).reduce((acc, key) => {
      const matcher = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return acc.replace(matcher, String(params[key]));
    }, template);
  }

  private getInitialLanguage(): SupportedLanguage {
    try {
      const stored = localStorage.getItem(this.storageKey) as SupportedLanguage | null;
      if (stored && this.supported.includes(stored)) {
        return stored;
      }
    } catch {
      // ignore storage issues
    }
    const browser = navigator?.language?.toLowerCase();
    return browser?.startsWith('he') ? 'he' : 'en';
  }

  private applyDocumentAttributes() {
    const dir = this.direction;
    this.document.documentElement.lang = this.currentLanguage;
    this.document.documentElement.dir = dir;
    this.document.body?.setAttribute('dir', dir);
  }

  private coerceDate(value: Date | string | number): Date {
    if (value instanceof Date) {
      return value;
    }
    return new Date(value);
  }
}
