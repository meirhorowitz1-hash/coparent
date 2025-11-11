import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-swap-request-modal',
  templateUrl: './swap-request-modal.component.html',
  styleUrls: ['./swap-request-modal.component.scss'],
  standalone: false
})
export class SwapRequestModalComponent implements OnInit {
  originalDate: string = '';
  proposedDate: string = '';
  reason: string = '';
  minDate: string = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    const today = new Date();
    this.minDate = today.toISOString();

    this.originalDate = this.minDate;

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.proposedDate = tomorrow.toISOString();
  }

  dismiss() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  submit() {
    if (!this.originalDate || !this.proposedDate) {
      console.log('Form is invalid');
      return;
    }

    const swapRequest = {
      originalDate: new Date(this.originalDate),
      proposedDate: new Date(this.proposedDate),
      reason: this.reason
    };
    console.log('confirm');
    this.modalCtrl.dismiss(swapRequest, 'confirm');
  }

  isFormValid(): boolean {
    return !!this.originalDate && !!this.proposedDate;
  }
}
