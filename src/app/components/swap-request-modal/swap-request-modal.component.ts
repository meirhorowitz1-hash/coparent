import { Component, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  selector: 'app-swap-request-modal',
  templateUrl: './swap-request-modal.component.html',
  styleUrls: ['./swap-request-modal.component.scss'],
  imports: [IonicModule, CommonModule, FormsModule]
})
export class SwapRequestModalComponent implements OnInit {
  originalDate: Date = new Date();
  proposedDate: Date = new Date();
  reason: string = '';
  minDate: string = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    // Set minimum date to today
    this.minDate = new Date().toISOString();
    
    // Set default proposed date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.proposedDate = tomorrow;
  }

  dismiss() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  submit() {
    if (!this.originalDate || !this.proposedDate) {
      return;
    }

    const swapRequest = {
      originalDate: this.originalDate,
      proposedDate: this.proposedDate,
      reason: this.reason
    };

    this.modalCtrl.dismiss(swapRequest, 'confirm');
  }

  isFormValid(): boolean {
    return !!this.originalDate && !!this.proposedDate;
  }
}
