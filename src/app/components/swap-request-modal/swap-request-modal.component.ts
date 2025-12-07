import { Component, OnInit, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { DatePipe } from '@angular/common';
import { SwapRequestType } from '../../core/models/swap-request.model';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-swap-request-modal',
  templateUrl: './swap-request-modal.component.html',
  styleUrls: ['./swap-request-modal.component.scss'],
  standalone: false,
  providers: [DatePipe]
})
export class SwapRequestModalComponent implements OnInit {
  @Input() initialOriginalDate?: string;
  @Input() lockOriginalDate = false;

  originalDate: string = '';
  proposedDate: string = '';
  reason: string = '';
  minDate: string = '';
  requestType: SwapRequestType = 'swap';

  constructor(
    private modalCtrl: ModalController,
    private i18n: I18nService,
    private datePipe: DatePipe
  ) {}

  ngOnInit() {
    const today = new Date();
    this.minDate = today.toISOString();
    this.originalDate = this.initialOriginalDate || this.minDate;

    const base = this.initialOriginalDate ? new Date(this.initialOriginalDate) : today;
    const tomorrow = new Date(base);
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.proposedDate = tomorrow.toISOString();
  }

  t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }

  formatDate(date: string): string {
    const locale = this.i18n.currentLanguage === 'he' ? 'he-IL' : 'en-US';
    return this.datePipe.transform(date, 'dd/MM/yyyy', '', locale) || '';
  }

  dismiss() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  submit() {
    if (!this.originalDate || (!this.proposedDate && this.requestType === 'swap')) {
      return;
    }

    const swapRequest = {
      originalDate: new Date(this.originalDate),
      proposedDate: this.requestType === 'swap' ? new Date(this.proposedDate) : null,
      reason: this.reason,
      requestType: this.requestType
    };
    this.modalCtrl.dismiss(swapRequest, 'confirm');
  }

  isFormValid(): boolean {
    if (!this.originalDate) return false;
    if (this.requestType === 'swap') return !!this.proposedDate;
    return true;
  }
}