import { Component, OnDestroy, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';

import { StorageService, StorageStats } from '../../core/services/storage.service';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-storage-stats',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="storage-card" *ngIf="stats">
      <div class="storage-header">
        <ion-icon name="cloud-outline"></ion-icon>
        <span>{{ i18n.translate('storage.title') }}</span>
      </div>

      <div class="storage-progress">
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            [style.width.%]="stats.percentage"
            [class.warning]="stats.percentage >= 80"
            [class.danger]="stats.percentage >= 95">
          </div>
        </div>
        <div class="progress-labels">
          <span class="used">{{ formatBytes(stats.totalUsed) }}</span>
          <span class="limit">{{ formatBytes(stats.limit) }}</span>
        </div>
      </div>

      <div class="storage-info">
        <span class="percentage" [class.warning]="stats.percentage >= 80">
          {{ stats.percentage }}%
        </span>
        <span class="remaining">
          {{ i18n.translate('storage.remaining', { amount: formatBytes(stats.remaining) }) }}
        </span>
      </div>

      <div class="storage-breakdown" *ngIf="showBreakdown">
        <div class="breakdown-title">{{ i18n.translate('storage.breakdown.title') }}</div>
        <div class="breakdown-items">
          <div class="breakdown-item">
            <ion-icon name="receipt-outline"></ion-icon>
            <span>{{ i18n.translate('storage.breakdown.paymentReceipts') }}</span>
            <span class="size">{{ formatBytes(stats.breakdown.paymentReceipts) }}</span>
          </div>
          <div class="breakdown-item">
            <ion-icon name="document-text-outline"></ion-icon>
            <span>{{ i18n.translate('storage.breakdown.documents') }}</span>
            <span class="size">{{ formatBytes(stats.breakdown.documents) }}</span>
          </div>
          <div class="breakdown-item">
            <ion-icon name="wallet-outline"></ion-icon>
            <span>{{ i18n.translate('storage.breakdown.expenseReceipts') }}</span>
            <span class="size">{{ formatBytes(stats.breakdown.expenseReceipts) }}</span>
          </div>
        </div>
      </div>

      <ion-chip 
        *ngIf="stats.percentage >= 80" 
        [color]="stats.percentage >= 95 ? 'danger' : 'warning'"
        class="warning-chip">
        <ion-icon name="warning-outline"></ion-icon>
        <ion-label>{{ i18n.translate('storage.warning.almostFull') }}</ion-label>
      </ion-chip>
    </div>

    <div class="storage-loading" *ngIf="!stats">
      <ion-spinner name="crescent"></ion-spinner>
    </div>
  `,
  styles: [`
    .storage-card {
      background: var(--ion-color-light);
      border-radius: 12px;
      padding: 16px;
      margin: 8px 0;
    }

    .storage-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--ion-color-dark);
    }

    .storage-header ion-icon {
      font-size: 20px;
      color: var(--ion-color-primary);
    }

    .storage-progress {
      margin-bottom: 8px;
    }

    .progress-bar {
      height: 8px;
      background: var(--ion-color-medium-tint);
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--ion-color-primary);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .progress-fill.warning {
      background: var(--ion-color-warning);
    }

    .progress-fill.danger {
      background: var(--ion-color-danger);
    }

    .progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--ion-color-medium);
      margin-top: 4px;
    }

    .storage-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      margin-bottom: 12px;
    }

    .percentage {
      font-weight: 600;
      color: var(--ion-color-dark);
    }

    .percentage.warning {
      color: var(--ion-color-warning-shade);
    }

    .remaining {
      color: var(--ion-color-medium);
    }

    .storage-breakdown {
      border-top: 1px solid var(--ion-color-light-shade);
      padding-top: 12px;
      margin-top: 4px;
    }

    .breakdown-title {
      font-size: 12px;
      color: var(--ion-color-medium);
      margin-bottom: 8px;
    }

    .breakdown-items {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .breakdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .breakdown-item ion-icon {
      font-size: 16px;
      color: var(--ion-color-medium);
    }

    .breakdown-item .size {
      margin-inline-start: auto;
      color: var(--ion-color-medium);
      font-weight: 500;
    }

    .warning-chip {
      margin-top: 8px;
    }

    .storage-loading {
      display: flex;
      justify-content: center;
      padding: 20px;
    }
  `]
})
export class StorageStatsComponent implements OnDestroy {
  private readonly storageService = inject(StorageService);
  readonly i18n = inject(I18nService);

  private destroy$ = new Subject<void>();

  @Input() showBreakdown = true;

  stats: StorageStats | null = null;

  constructor() {
    this.storageService.stats$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => {
        this.stats = stats;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  formatBytes(bytes: number): string {
    return this.storageService.formatBytes(bytes);
  }
}
