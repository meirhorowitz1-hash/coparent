import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { Subject, Subscription, takeUntil, firstValueFrom } from 'rxjs';

import { HomeService } from '../../core/services/home.service';
import { Expense, ExpenseStatus } from '../../core/models/expense.model';
import { ExpenseStoreService } from '../../core/services/expense-store.service';
import { CalendarService } from '../../core/services/calendar.service';
import { DailyOverview, QuickAction } from '../../core/models/daily-overview.model';
import { SwapRequestModalComponent } from '../../components/swap-request-modal/swap-request-modal.component';
import { SwapRequest, SwapRequestStatus } from '../../core/models/swap-request.model';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { Task, TaskStatus } from '../../core/models/task.model';
import { InAppNotification, PushNotificationService } from '../../core/services/push-notification.service';
import { I18nService } from '../../core/services/i18n.service';

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
  TaskStatus = TaskStatus;
  currentUserId: string | null = null;
  openAccordions: string[] = [];
  currentParentRole: 'parent1' | 'parent2' | null = null;
  notifications: InAppNotification[] = [];
  isNotificationsOpen = false;
  notificationsEvent?: Event;
  private readonly supportEmail = 'support@coparent.app';
  private readonly supportWhatsAppNumber = '972500000000';

  private destroy$ = new Subject<void>();
  private langSub?: Subscription;

  constructor(
    private homeService: HomeService,
    private router: Router,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private expenseStore: ExpenseStoreService,
    private calendarService: CalendarService,
    private taskHistoryService: TaskHistoryService,
    private pushNotificationService: PushNotificationService,
    private i18n: I18nService
  ) {}

  ngOnInit() {
    this.loadData();
    this.subscribeToOverview();
    this.subscribeToNotifications();
    this.langSub = this.i18n.language$.subscribe(() => this.refreshQuickActions());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.langSub?.unsubscribe();
  }

  /**
   * טעינת נתונים ראשונית
   */
  loadData() {
    this.homeService.loadDailyOverview(this.currentDate);
    this.refreshQuickActions();
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
        
        // Refresh quick actions when overview changes
        this.refreshQuickActions();
      });

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const uid = this.calendarService.getCurrentUserId();
        this.currentParentRole = this.calendarService.getParentRoleForUser(uid);
      });
  }

  /**
   * מאזין להודעות Push בתוך האפליקציה
   */
  private subscribeToNotifications() {
    this.pushNotificationService.notifications$
      .pipe(takeUntil(this.destroy$))
      .subscribe(notifications => {
        this.notifications = notifications;
      });
  }

  /**
   * רענון הנתונים
   */
  async handleRefresh(event: any) {
    await firstValueFrom(this.homeService.refresh());
    this.refreshQuickActions();
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

  goToProfile() {
    this.router.navigate(['/tabs/profile']);
  }

  openNotifications(event: Event) {
    if (!this.notifications.length) {
      return;
    }
    this.notificationsEvent = event;
    this.isNotificationsOpen = true;
  }

  onNotificationsDismiss() {
    this.isNotificationsOpen = false;
    this.notificationsEvent = undefined;
    if (this.notifications.length) {
      this.pushNotificationService.clearNotifications();
    }
  }

  openSupportMail() {
    const subject = this.i18n.translate('home.support.emailSubject');
    const mailto = `mailto:${this.supportEmail}?subject=${encodeURIComponent(subject)}`;
    window.open(mailto, '_blank');
  }

  openSupportWhatsApp() {
    const message = this.i18n.translate('home.support.whatsappMessage');
    const waLink = `https://wa.me/${this.supportWhatsAppNumber}?text=${encodeURIComponent(message)}`;
    window.open(waLink, '_blank');
  }

  /**
   * ביצוע פעולה מהירה
   */
  async executeQuickAction(action: QuickAction) {
    if (action.disabled) {
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
        await this.presentToast(this.i18n.translate('home.toast.requestSent'), 'success');
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
  formatDate(date: Date | string | null | undefined): string {
    if (!date) {
      return this.i18n.translate('home.noDueDate');
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return this.i18n.translate('home.noDueDate');
    }
    return this.i18n.formatDate(d, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * פורמט זמן
   */
  formatTime(date: Date | string | null | undefined): string {
    if (!date) {
      return '';
    }
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      return '';
    }
    return this.i18n.formatTime(parsed);
  }

  getChildLabel(childId?: string | null): string {
    if (!childId) {
      return '';
    }
    return childId;
  }

  formatNotificationTime(timestamp: number): string {
    return this.i18n.formatTime(timestamp);
  }

  /**
   * פורמט מטבע
   */
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat(this.i18n.locale, { 
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

  getPriorityLabel(priority: string): string {
    const key: Record<string, string> = {
      urgent: 'home.taskPriority.urgent',
      high: 'home.taskPriority.high',
      medium: 'home.taskPriority.medium',
      low: 'home.taskPriority.low'
    };
    const translationKey = key[priority];
    return translationKey ? this.i18n.translate(translationKey) : priority;
  }

  async completeTask(task: Task, checked: boolean) {
    if (!checked) {
      return;
    }
    try {
      await this.taskHistoryService.updateStatus(task.id, TaskStatus.COMPLETED);
    } catch (error) {
      const toast = await this.toastCtrl.create({
        message: this.i18n.translate('home.toast.taskUpdateFailed'),
        duration: 2000,
        color: 'danger'
      });
      toast.present();
    }
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

  get todayTasks(): Task[] {
    if (!this.dailyOverview) {
      return [];
    }
    return this.dailyOverview.upcomingTasks.filter(task => {
      if (task.status === TaskStatus.COMPLETED || !task.dueDate) {
        return false;
      }
      return this.isToday(task.dueDate);
    });
  }

  private isToday(date: Date | string): boolean {
    const target = new Date(date);
    if (isNaN(target.getTime())) {
      return false;
    }
    const now = new Date();
    return (
      target.getFullYear() === now.getFullYear() &&
      target.getMonth() === now.getMonth() &&
      target.getDate() === now.getDate()
    );
  }

  getRequestStatusLabel(status: SwapRequestStatus): string {
    const labels: Record<SwapRequestStatus, string> = {
      [SwapRequestStatus.PENDING]: 'home.request.status.pending',
      [SwapRequestStatus.APPROVED]: 'home.request.status.approved',
      [SwapRequestStatus.REJECTED]: 'home.request.status.rejected',
      [SwapRequestStatus.CANCELLED]: 'home.request.status.cancelled'
    };
    return this.i18n.translate(labels[status]);
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
      this.presentErrorToast(this.i18n.translate('home.toast.statusUpdateFailed'));
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
          text: this.i18n.translate('home.toast.close'),
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

  private refreshQuickActions() {
    this.quickActions = this.translateQuickActions(this.homeService.getQuickActions());
  }

  private translateQuickActions(actions: QuickAction[]): QuickAction[] {
    const titleKey: Record<string, string> = {
      'pending-expenses': 'home.quick.expenses.title',
      'swap-requests': 'home.quick.swap.title',
      documents: 'home.quick.documents.title'
    };
    const emptyKey: Record<string, string> = {
      'pending-expenses': 'home.quick.expenses.empty',
      'swap-requests': 'home.quick.swap.empty'
    };

    return actions.map(action => ({
      ...action,
      title: this.i18n.translate(titleKey[action.id] || action.title),
      emptyLabel: action.emptyLabel
        ? this.i18n.translate(emptyKey[action.id] || action.emptyLabel)
        : undefined
    }));
  }

  getRequestTypeLabel(request: SwapRequest): string {
    return request.requestType === 'one-way'
      ? this.i18n.translate('home.request.type.oneWay')
      : this.i18n.translate('home.request.type.swap');
  }

  canApproveExpense(expense: Expense): boolean {
    return (
      !!this.currentUserId &&
      expense.status === ExpenseStatus.PENDING &&
      expense.paidBy !== this.currentUserId
    );
  }

  async handleExpenseApproval(expenseId: string, approved: boolean, event?: Event) {
    event?.stopPropagation();
    const expense = this.dailyOverview?.pendingExpenses.find(e => e.id === expenseId);
    if (!expense || !this.canApproveExpense(expense)) {
      return;
    }
    try {
      await this.expenseStore.setStatus(expenseId, approved ? 'approved' : 'rejected');
      await this.presentToast(
        approved ? this.i18n.translate('home.toast.expenseApproved') : this.i18n.translate('home.toast.expenseRejected')
      );
    } catch (error) {
      console.error('Failed to update expense from home', error);
      await this.presentToast(this.i18n.translate('home.toast.expenseUpdateFailed'), 'danger');
    }
  }

  private mapSwapErrorMessage(code?: string): string {
    switch (code) {
      case 'swap-invalid-original-day':
        return this.i18n.translate('home.swapError.invalidOriginal');
      case 'swap-missing-proposed-day':
      case 'swap-invalid-proposed-day':
        return this.i18n.translate('home.swapError.missingProposed');
      case 'swap-proposed-same-parent':
        return this.i18n.translate('home.swapError.sameParent');
      default:
        return this.i18n.translate('home.swapError.generic');
    }
  }
}
