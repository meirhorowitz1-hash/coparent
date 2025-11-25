import { Component, OnInit, OnDestroy } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { Subject, takeUntil } from 'rxjs';

import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';
import { SwapRequestService } from '../../core/services/swap-request.service';

type RequestFilter = 'all' | SwapRequestStatus;

@Component({
  selector: 'app-swap-history',
  templateUrl: './swap-history.page.html',
  styleUrls: ['./swap-history.page.scss'],
  standalone: false
})
export class SwapHistoryPage implements OnInit, OnDestroy {
  swapRequests: SwapRequest[] = [];
  requestNotes: Record<string, string> = {};
  requestFilter: RequestFilter = 'all';
  SwapRequestStatus = SwapRequestStatus;
  isLoading = true;
  currentUserId: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private swapRequestService: SwapRequestService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    this.swapRequestService.swapRequests$
      .pipe(takeUntil(this.destroy$))
      .subscribe(requests => {
        this.swapRequests = requests;
        this.currentUserId = this.swapRequestService.getCurrentUserId();
        this.isLoading = false;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get filteredSwapRequests(): SwapRequest[] {
    if (this.requestFilter === 'all') {
      return this.swapRequests;
    }
    return this.swapRequests.filter(request => request.status === this.requestFilter);
  }

  getStatusCount(status: SwapRequestStatus): number {
    return this.swapRequests.filter(request => request.status === status).length;
  }

  getRequestStatusLabel(status: SwapRequestStatus): string {
    const labels: Record<SwapRequestStatus, string> = {
      [SwapRequestStatus.PENDING]: 'ממתינה',
      [SwapRequestStatus.APPROVED]: 'אושרה',
      [SwapRequestStatus.REJECTED]: 'נדחתה',
      [SwapRequestStatus.CANCELLED]: 'בוטלה'
    };
    return labels[status];
  }

  getRequestStatusColor(status: SwapRequestStatus): string {
    const colors: Record<SwapRequestStatus, string> = {
      [SwapRequestStatus.PENDING]: 'warning',
      [SwapRequestStatus.APPROVED]: 'success',
      [SwapRequestStatus.REJECTED]: 'danger',
      [SwapRequestStatus.CANCELLED]: 'medium'
    };
    return colors[status] || 'medium';
  }

  formatDate(date: Date | string | number): string {
    return new Date(date).toLocaleDateString('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  canRespondToRequest(request: SwapRequest): boolean {
    return (
      request.status === SwapRequestStatus.PENDING &&
      !!this.currentUserId &&
      request.requestedTo === this.currentUserId
    );
  }

  canCancelRequest(request: SwapRequest): boolean {
    return (
      request.status === SwapRequestStatus.PENDING &&
      !!this.currentUserId &&
      request.requestedBy === this.currentUserId
    );
  }

  private canPerformAction(request: SwapRequest, status: SwapRequestStatus): boolean {
    if (status === SwapRequestStatus.CANCELLED) {
      return this.canCancelRequest(request);
    }
    return this.canRespondToRequest(request);
  }

  async handleRequestAction(request: SwapRequest, status: SwapRequestStatus) {
    if (!this.canPerformAction(request, status)) {
      return;
    }

    const note =
      status === SwapRequestStatus.CANCELLED ? undefined : (this.requestNotes[request.id] || '');

    try {
      await this.swapRequestService.updateSwapRequestStatus(request.id, status, note);
      if (status !== SwapRequestStatus.CANCELLED) {
        this.requestNotes = {
          ...this.requestNotes,
          [request.id]: ''
        };
      }
    } catch (error) {
      console.error('Failed to update swap request', error);
      this.presentErrorToast('עדכון הסטטוס נכשל, נסו שוב.');
    }
  }

  private async presentErrorToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3500,
      color: 'danger',
      position: 'bottom',
      buttons: [
        {
          text: 'סגור',
          role: 'cancel'
        }
      ]
    });

    await toast.present();
  }
}
