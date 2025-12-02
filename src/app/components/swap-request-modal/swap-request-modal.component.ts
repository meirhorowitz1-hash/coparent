import { Component, OnInit, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { SwapRequestType } from '../../core/models/swap-request.model';

@Component({
  selector: 'app-swap-request-modal',
  templateUrl: './swap-request-modal.component.html',
  styleUrls: ['./swap-request-modal.component.scss'],
  standalone: false
})
export class SwapRequestModalComponent implements OnInit {
  @Input() initialOriginalDate?: string;
  @Input() lockOriginalDate = false;

  originalDate: string = '';
  proposedDate: string = '';
  reason: string = '';
  minDate: string = '';
  requestType: SwapRequestType = 'swap';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    const today = new Date();
    this.minDate = today.toISOString();

    this.originalDate = this.initialOriginalDate || this.minDate;

    const base = this.initialOriginalDate ? new Date(this.initialOriginalDate) : today;
    const tomorrow = new Date(base);
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.proposedDate = tomorrow.toISOString();
  }

  dismiss() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  submit() {
    if (!this.originalDate || (!this.proposedDate && this.requestType === 'swap')) {
      console.log('Form is invalid');
      return;
    }

    const swapRequest = {
      originalDate: new Date(this.originalDate),
      proposedDate: this.requestType === 'swap' ? new Date(this.proposedDate) : null,
      reason: this.reason,
      requestType: this.requestType
    };
    console.log('confirm');
    this.modalCtrl.dismiss(swapRequest, 'confirm');
  }

  isFormValid(): boolean {
    if (!this.originalDate) {
      return false;
    }

    if (this.requestType === 'swap') {
      return !!this.proposedDate;
    }

    return true;
  }
}
