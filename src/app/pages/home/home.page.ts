import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';

import { HomeService } from '../../core/services/home.service';
import { DailyOverview, QuickAction } from '../../core/models/daily-overview.model';
import { SwapRequestModalComponent } from '../../components/swap-request-modal/swap-request-modal.component';
import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit, OnDestroy {
  dailyOverview: DailyOverview | null = null;
  quickActions: QuickAction[] = [];
  isLoading = true;
  currentDate = new Date();
  swapRequests: SwapRequest[] = [];
  requestNotes: Record<string, string> = {};
  SwapRequestStatus = SwapRequestStatus;
  currentUserId: string | null = null;
  openAccordions: string[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private homeService: HomeService,
    private router: Router,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadData();
    this.subscribeToOverview();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * טעינת נתונים ראשונית
   */
  loadData() {
    this.homeService.loadDailyOverview(this.currentDate);
    this.quickActions = this.homeService.getQuickActions();
  }

  /**
   * מאזין לשינויים במצב היומי
   */
  private subscribeToOverview() {
    this.homeService.dailyOverview$
      .pipe(takeUntil(this.destroy$))
      .subscribe(overview => {
        this.dailyOverview = overview;
        this.swapRequests = overview?.swapRequests ?? [];
        this.currentUserId = this.homeService.getCurrentUserId();
        this.isLoading = false;

        if (overview) {
          this.syncOpenAccordions(overview);
        }
      });
  }

  /**
   * רענון הנתונים
   */
  async handleRefresh(event: any) {
    await firstValueFrom(this.homeService.refresh());
    this.quickActions = this.homeService.getQuickActions();
    event.target.complete();
  }

  /**
   * רענון ידני מהטולבר
   */
  manualRefresh() {
    this.handleRefresh({
      target: {
        complete: () => {}
      }
    });
  }

  /**
   * ביצוע פעולה מהירה
   */
  async executeQuickAction(action: QuickAction) {
    // מקרה מיוחד לבקשת החלפה - נפתח Modal
    if (action.id === 'swap-request') {
      await this.openModal();
      return;
    }

    if (action.route) {
      this.router.navigate([`/tabs${action.route}`]);
    } else if (action.action) {
      action.action();
    }
  }

  /**
   * פתיחת Modal לבקשת החלפה
   */
 
  async openModal() {
    const modal = await this.modalCtrl.create({
      component: SwapRequestModalComponent,
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'confirm' && data) {
      try {
        await this.homeService.submitSwapRequest({
          originalDate: data.originalDate,
          proposedDate: data.proposedDate ?? null,
          reason: data.reason,
          requestType: data.requestType
        });
        await this.presentToast('הבקשה נשלחה בהצלחה', 'success');
      } catch (error: any) {
        console.error('Failed to submit swap request', error);
        await this.presentToast(this.mapSwapErrorMessage(error?.message), 'danger');
      }
    }
  }

  /**
   * ניווט לאירוע
   */
  navigateToEvent(eventId: string) {
    this.router.navigate(['/tabs/calendar'], { 
      queryParams: { eventId } 
    });
  }

  /**
   * ניווט למשימה
   */
  navigateToTask(taskId: string) {
    this.router.navigate(['/tabs/tasks'], { 
      queryParams: { taskId } 
    });
  }

  /**
   * ניווט להוצאה
   */
  navigateToExpense(expenseId: string, openSummary = false) {
    this.router.navigate(['/tabs/expenses'], { 
      queryParams: { expenseId, ...(openSummary ? { openSummary: true } : {}) } 
    });
  }

  /**
   * פורמט תאריך
   */
  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('he-IL', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  /**
   * פורמט זמן
   */
  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('he-IL', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  /**
   * פורמט מטבע
   */
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('he-IL', { 
      style: 'currency', 
      currency: 'ILS' 
    }).format(amount);
  }

  /**
   * מחזיר צבע לפי עדיפות משימה
   */
  getTaskPriorityColor(priority: string): string {
    const colors: { [key: string]: string } = {
      'urgent': 'danger',
      'high': 'warning',
      'medium': 'primary',
      'low': 'medium'
    };
    return colors[priority] || 'medium';
  }

  /**
   * מחזיר אייקון לפי קטגוריה
   */
  getCategoryIcon(category: string): string {
    const icons: { [key: string]: string } = {
      'medical': 'medical',
      'education': 'school',
      'activity': 'football',
      'shopping': 'cart',
      'household': 'home',
      'paperwork': 'document',
      'food': 'restaurant',
      'clothing': 'shirt',
      'transportation': 'car',
      'childcare': 'people',
      'toys': 'game-controller',
      'other': 'ellipsis-horizontal'
    };
    return icons[category] || 'help-circle';
  }

  get pendingSwapRequests(): SwapRequest[] {
    return this.swapRequests.filter(request => request.status === SwapRequestStatus.PENDING);
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
      await this.homeService.updateSwapRequestStatus(request.id, status, note);
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

  private async presentToast(message: string, color: 'success' | 'danger' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });

    await toast.present();
  }

  private syncOpenAccordions(overview: DailyOverview) {
    const current = new Set(this.openAccordions);

    if (overview.pendingExpenses.length > 0) {
      current.add('expenses');
    }
    if (this.pendingSwapRequests.length > 0) {
      current.add('requests');
    }
    if (overview.events.length > 0) {
      current.add('events');
    }

    this.openAccordions = Array.from(current);
  }

  getRequestTypeLabel(request: SwapRequest): string {
    return request.requestType === 'one-way' ? 'בקשה ללא החזרה' : 'בקשת החלפה';
  }

  private mapSwapErrorMessage(code?: string): string {
    switch (code) {
      case 'swap-invalid-original-day':
        return 'אי אפשר לבקש החלפה על יום שאינו שלך';
      case 'swap-missing-proposed-day':
      case 'swap-invalid-proposed-day':
        return 'בחרי תאריך חלופי תקין של ההורה השני';
      case 'swap-proposed-same-parent':
        return 'תאריך החלופי חייב להיות של ההורה השני';
      default:
        return 'שליחת הבקשה נכשלה, בדקו את התאריכים ונסו שוב';
    }
  }
}
