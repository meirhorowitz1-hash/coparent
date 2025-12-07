import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';

import { I18nService } from '../../core/services/i18n.service';

@Pipe({
  name: 't',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform, OnDestroy {
  private langSub: Subscription;

  constructor(private i18n: I18nService, private cdr: ChangeDetectorRef) {
    this.langSub = this.i18n.language$.subscribe(() => this.cdr.markForCheck());
  }

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }

  ngOnDestroy(): void {
    this.langSub.unsubscribe();
  }
}
