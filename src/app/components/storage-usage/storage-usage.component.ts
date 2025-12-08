import { Component, OnInit, OnDestroy, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';

import { StorageService, StorageStats } from '../../core/services/storage.service';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-storage-usage',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="storage-usage-card">
      <div class="storage-header">
        <ion-icon name="cloud-outline"></ion-icon>
        <span class="storage-title">{{ i18n.translate('storage.title') }}</span>
      </div>
      
      <div class="storage-bar-container">
        <div class="storage-bar">
          <div 
            class="storage-bar-fill"
            [style.width.%]="stats.percentage"
            [class.warning]="stats.percentage >= 70 && stats.percentage < 90"
            [class.danger]="stats.percentage >= 90"
          ></div>
        </div>
        <div class="storage-labels">
          <span class="storage-used">{{ formatBytes(stats.totalUsed||0)}}</span>
          <span class="storage-limit">{{ formatBytes(stats.limit||0) }}</span>
        </div>
      </div>

      <div class="storage-remaining">
        {{ i18n.translate('storage.remaining', { amount: formatBytes(stats.remaining||0) }) }}
      </div>

      @if (showBreakdown) {
        <div class="storage-breakdown">
          <div class="breakdown-item">
            <ion-icon name="receipt-outline"></ion-icon>
            <span class="breakdown-label">{{ i18n.translate('storage.breakdown.receipts') }}</span>
            <span class="breakdown-value">{{ formatBytes(stats.breakdown.paymentReceipts||0) }}</span>
          </div>
          <div class="breakdown-item">
            <ion-icon name="document-outline"></ion-icon>
            <span class="breakdown-label">{{ i18n.translate('storage.breakdown.documents') }}</span>
            <span class="breakdown-value">{{ formatBytes(stats.breakdown.documents||0) }}</span>
          </div>
          <div class="breakdown-item">
            <ion-icon name="wallet-outline"></ion-icon>
            <span class="breakdown-label">{{ i18n.translate('storage.breakdown.expenses') }}</span>
            <span class="breakdown-value">{{ formatBytes(stats.breakdown.expenseReceipts||0) }}</span>
          </div>
        </div>
      }

      @if (stats.percentage >= 90) {
        <div class="storage-warning">
          <ion-icon name="warning-outline"></ion-icon>
          {{ i18n.translate('storage.warning.almostFull') }}
        </div>
      }
    </div>
  `,
  styles: [`
    .storage-usage-card {
      background: var(--ion-color-light);
      border-radius: 12px;
      padding: 16px;
      margin: 8px 0;
    }

    .storage-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;

      ion-icon {
        font-size: 20px;
        color: var(--ion-color-primary);
      }

      .storage-title {
        font-weight: 600;
        font-size: 14px;
        color: var(--ion-text-color);
      }
    }

    .storage-bar-container {
      margin-bottom: 8px;
    }

    .storage-bar {
      height: 8px;
      background: var(--ion-color-medium-tint);
      border-radius: 4px;
      overflow: hidden;
    }

    .storage-bar-fill {
      height: 100%;
      background: var(--ion-color-primary);
      border-radius: 4px;
      transition: width 0.3s ease, background 0.3s ease;

      &.warning {
        background: var(--ion-color-warning);
      }

      &.danger {
        background: var(--ion-color-danger);
      }
    }

    .storage-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 12px;
      color: var(--ion-color-medium);
    }

    .storage-remaining {
      text-align: center;
      font-size: 13px;
      color: var(--ion-color-medium-shade);
      margin-bottom: 12px;
    }

    .storage-breakdown {
      border-top: 1px solid var(--ion-color-light-shade);
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .breakdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;

      ion-icon {
        font-size: 16px;
        color: var(--ion-color-medium);
      }

      .breakdown-label {
        flex: 1;
        color: var(--ion-color-medium-shade);
      }

      .breakdown-value {
        font-weight: 500;
        color: var(--ion-text-color);
      }
    }

    .storage-warning {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      padding: 8px 12px;
      background: var(--ion-color-danger-tint);
      color: var(--ion-color-danger-shade);
      border-radius: 8px;
      font-size: 13px;

      ion-icon {
        font-size: 18px;
      }
    }
  `]
})
export class StorageUsageComponent implements OnInit, OnDestroy {
  private readonly storageService = inject(StorageService);
  readonly i18n = inject(I18nService);

  private destroy$ = new Subject<void>();

  @Input() showBreakdown = true;

  stats: StorageStats = {
    totalUsed: 0,
    limit: 5 * 1024 * 1024 * 1024,
    percentage: 0,
    remaining: 5 * 1024 * 1024 * 1024,
    breakdown: { paymentReceipts: 0, documents: 0, expenseReceipts: 0 }
  };

  ngOnInit(): void {
    this.storageService.initialize();
    
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
