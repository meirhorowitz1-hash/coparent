import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IonTabs } from '@ionic/angular';
import { Subject, Subscription, of } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';

type TabsDidChangeEventDetail = {
  tab?: string;
};
import { addIcons } from 'ionicons';
import {
  homeOutline,
  home,
  calendarOutline,
  calendar,
  cashOutline,
  cash,
  documentTextOutline,
  documentText,
  chatbubbleEllipsesOutline,
  chatbubbleEllipses
} from 'ionicons/icons';
import { ChatService, ChatMessage } from '../../core/services/chat.service';
import { ExpenseStoreService } from '../../core/services/expense-store.service';
import { SwapRequestService } from '../../core/services/swap-request.service';
import { SwapRequestStatus } from '../../core/models/swap-request.model';
import { CalendarService } from '../../core/services/calendar.service';
import { CalendarEvent } from '../../core/models/calendar-event.model';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  standalone: false
})
export class TabsPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(IonTabs, { static: true }) private ionTabs?: IonTabs;

  protected tabs: { id: string; label: string; icon: string; activeIcon: string }[] = [];

  protected selectedTab = 'home';
  protected pendingExpensesCount = 0;
  protected pendingCalendarCount = 0;
  protected chatUnreadCount = 0;
  protected pendingTemplateApproval = false;
  private currentParentRole: 'parent1' | 'parent2' | 'both' | null = null;
  private currentUserId: string | null = null;
  private seenEventIds = new Set<string>();
  private relevantEventIds: string[] = [];
  private newEventsCount = 0;
  private seenChatMessageIds = new Set<string>();
  private latestChatMessages: ChatMessage[] = [];
  private parentMetadata: any = null;
  private activeFamilyId: string | null = null;
  private chatSeenStore: Record<string, number> = {};
  private destroy$ = new Subject<void>();
  private langSub?: Subscription;

  constructor(
    private expenseStore: ExpenseStoreService,
    private swapRequestService: SwapRequestService,
    private calendarService: CalendarService,
    private chatService: ChatService,
    private i18n: I18nService
  ) {
    this.chatSeenStore = this.loadChatSeenStore();
    addIcons({
      homeOutline,
      home,
      calendarOutline,
      calendar,
      cashOutline,
      cash,
      documentTextOutline,
      documentText,
      chatbubbleEllipsesOutline,
      chatbubbleEllipses
    });
    this.buildTabs();
  }

  ngOnInit(): void {
    this.langSub = this.i18n.language$.subscribe(() => this.buildTabs());

    this.currentUserId = this.calendarService.getCurrentUserId();
    this.currentParentRole = this.calendarService.getParentRoleForUser(this.currentUserId) || null;

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(metadata => {
        this.parentMetadata = metadata;
        const uid = this.calendarService.getCurrentUserId();
        this.currentParentRole = this.calendarService.getParentRoleForUser(uid) || null;
      });

    this.expenseStore.expenses$
      .pipe(takeUntil(this.destroy$))
      .subscribe(expenses => {
        this.currentUserId = this.calendarService.getCurrentUserId();
        this.pendingExpensesCount = expenses.filter(expense => {
          const isPending = expense.status === 'pending';
          const isMine = this.currentUserId ? expense.createdBy === this.currentUserId : false;
          return isPending && !isMine;
        }).length;
      });

    this.swapRequestService.swapRequests$
      .pipe(takeUntil(this.destroy$))
      .subscribe(requests => {
        const uid = this.calendarService.getCurrentUserId();
        this.pendingCalendarCount = requests.filter(
          req => req.status === SwapRequestStatus.PENDING && uid && req.requestedTo === uid
        ).length;
      });

    this.calendarService.custodySchedule$
      .pipe(takeUntil(this.destroy$))
      .subscribe(schedule => {
        const uid = this.calendarService.getCurrentUserId();
        this.currentUserId = uid;
        this.pendingTemplateApproval = !!(
          schedule?.pendingApproval &&
          uid &&
          schedule.pendingApproval.requestedBy !== uid
        );
      });

    this.calendarService.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(events => {
        const uid = this.calendarService.getCurrentUserId();
        const role = this.calendarService.getParentRoleForUser(uid);
        this.currentUserId = uid;
        this.currentParentRole = role || null;

        const relevant = events.filter(event =>
          this.isEventRelevantToCurrentUser(event, uid, role)
        );
        this.relevantEventIds = relevant.map(ev => ev.id);

        const unseen = this.relevantEventIds.filter(id => !this.seenEventIds.has(id));
        if (this.selectedTab === 'calendar') {
          unseen.forEach(id => this.seenEventIds.add(id));
          this.newEventsCount = 0;
        } else {
          this.newEventsCount = unseen.length;
        }
      });

    this.calendarService.activeFamilyId$
      .pipe(
        takeUntil(this.destroy$),
        switchMap(familyId => {
          this.activeFamilyId = familyId;
          this.seenChatMessageIds.clear();
          this.chatUnreadCount = 0;
          this.latestChatMessages = [];
          if (!familyId) {
            return of<ChatMessage[]>([]);
          }
          return this.chatService.listenToMessages(familyId);
        })
      )
      .subscribe(messages => this.handleChatMessages(messages));
  }

  async ngAfterViewInit(): Promise<void> {
    const currentlySelected = await this.ionTabs?.getSelected();
    if (currentlySelected) {
      this.selectedTab = currentlySelected;
    }
  }

  protected onTabChange(event: TabsDidChangeEventDetail) {
    if (event?.tab) {
      this.selectedTab = event.tab;

      if (event.tab === 'calendar') {
        this.relevantEventIds.forEach(id => this.seenEventIds.add(id));
        this.newEventsCount = 0;
      }

      if (event.tab === 'chat') {
        this.markChatMessagesAsSeen(this.latestChatMessages);
        this.chatUnreadCount = 0;
      }
    }
  }

  protected isSelected(tabId: string): boolean {
    return this.selectedTab === tabId;
  }

  protected getBadgeCount(tabId: string): number {
    if (tabId === 'expenses') {
      return this.pendingExpensesCount;
    }
    if (tabId === 'calendar') {
      return this.pendingCalendarCount + this.newEventsCount + (this.pendingTemplateApproval ? 1 : 0);
    }
    if (tabId === 'chat') {
      return this.chatUnreadCount;
    }
    return 0;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.langSub?.unsubscribe();
  }

  private handleChatMessages(messages: ChatMessage[]): void {
    this.latestChatMessages = messages;
    this.currentUserId = this.calendarService.getCurrentUserId();
    if (this.selectedTab === 'chat') {
      this.markChatMessagesAsSeen(messages);
      this.chatUnreadCount = 0;
      return;
    }

    const unseen = messages.filter(msg => {
      const isMine = msg.senderId === this.currentUserId;
      if (isMine) {
        return false;
      }
      const hasSeen = this.seenChatMessageIds.has(msg.id);
      const afterLastSeen = this.isAfterLastSeen(msg.sentAt);
      return !hasSeen && afterLastSeen;
    });
    this.chatUnreadCount = unseen.length;
  }

  private markChatMessagesAsSeen(messages?: ChatMessage[]): void {
    const list = messages ?? this.latestChatMessages;
    const now = Date.now();
    list.forEach(msg => {
      if (msg.senderId !== this.currentUserId) {
        this.seenChatMessageIds.add(msg.id);
      }
    });
    if (this.activeFamilyId) {
      this.chatSeenStore[this.activeFamilyId] = now;
      this.persistChatSeenStore();
    }
  }

  private isEventRelevantToCurrentUser(
    event: CalendarEvent,
    uid: string | null,
    role: 'parent1' | 'parent2' | null
  ): boolean {
    if (!uid) {
      return false;
    }
    if (event.createdBy && event.createdBy === uid) {
      return false;
    }

    const meta = this.parentMetadata || {};
    const parent1Uid = meta.parent1?.uid;
    const parent2Uid = meta.parent2?.uid;
    const effectiveRole =
      role ||
      (parent1Uid && uid === parent1Uid ? 'parent1' : parent2Uid && uid === parent2Uid ? 'parent2' : null);

    const targetsUid = event.targetUids?.includes(uid);
    const targetsRole =
      event.parentId === 'both' ||
      (effectiveRole === 'parent1' && event.parentId === 'parent1') ||
      (effectiveRole === 'parent2' && event.parentId === 'parent2') ||
      (event.parentId === 'parent1' && parent1Uid && uid === parent1Uid) ||
      (event.parentId === 'parent2' && parent2Uid && uid === parent2Uid);

    return !!(targetsUid || targetsRole);
  }

  private isAfterLastSeen(sentAt?: Date): boolean {
    if (!this.activeFamilyId) {
      return true;
    }
    const lastSeen = this.chatSeenStore[this.activeFamilyId] ?? 0;
    const sent = sentAt ? new Date(sentAt).getTime() : 0;
    return sent > lastSeen;
  }

  private loadChatSeenStore(): Record<string, number> {
    try {
      const raw = localStorage.getItem('coparent-chat-seen');
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, number>;
      }
    } catch {
      // ignore
    }
    return {};
  }

  private persistChatSeenStore(): void {
    try {
      localStorage.setItem('coparent-chat-seen', JSON.stringify(this.chatSeenStore));
    } catch {
      // ignore
    }
  }

  private buildTabs() {
    this.tabs = [
      { id: 'home', label: this.i18n.translate('tabs.home'), icon: 'home-outline', activeIcon: 'home' },
      { id: 'calendar', label: this.i18n.translate('tabs.calendar'), icon: 'calendar-outline', activeIcon: 'calendar' },
      { id: 'expenses', label: this.i18n.translate('tabs.expenses'), icon: 'cash-outline', activeIcon: 'cash' },
      { id: 'documents', label: this.i18n.translate('tabs.documents'), icon: 'document-text-outline', activeIcon: 'document-text' },
      { id: 'chat', label: this.i18n.translate('tabs.chat'), icon: 'chatbubble-ellipses-outline', activeIcon: 'chatbubble-ellipses' }
    ];
  }
}
