import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, of } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { ChatMessage, ChatService } from '../../core/services/chat.service';
import { CalendarService } from '../../core/services/calendar.service';
import { AuthService } from '../../core/services/auth.service';
import { FamilyService } from '../../core/services/family.service';
import { Family } from '../../core/models/family.model';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
  standalone: false
})
export class ChatPage implements OnInit, OnDestroy {
  messages: ChatMessage[] = [];
  familyId: string | null = null;
  messageText = '';
  isSending = false;
  currentUserId: string | null = null;
  currentUserName = '';
  otherParentName = '';
  familyName = '';

  private destroy$ = new Subject<void>();
  private langSub?: Subscription;
  private defaultMe = '';
  private defaultParent = '';
  private defaultChatTitle = '';

  constructor(
    private chatService: ChatService,
    private calendarService: CalendarService,
    private authService: AuthService,
    private familyService: FamilyService,
    private i18n: I18nService
  ) {
    this.resetFallbackLabels();
    this.langSub = this.i18n.language$.subscribe(() => this.resetFallbackLabels());
  }

  ngOnInit(): void {
    this.authService.user$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUserId = user?.uid ?? null;
        this.currentUserName = user?.displayName || user?.email || 'אני';
        this.updateOtherParentName();
      });

    this.calendarService.parentMetadata$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.updateOtherParentName());

    this.calendarService.activeFamilyId$
      .pipe(
        takeUntil(this.destroy$),
        switchMap(familyId => {
          this.familyId = familyId;
          this.familyName = this.i18n.translate('chat.titleDefault');
          if (!familyId) {
            return of<ChatMessage[]>([]);
          }
          return this.chatService.listenToMessages(familyId);
        })
      )
      .subscribe(messages => {
        this.messages = messages;
      });

    this.calendarService.activeFamilyId$
      .pipe(
        takeUntil(this.destroy$),
        switchMap(familyId => {
          if (!familyId) {
            return of<Family | null>(null);
          }
          return this.familyService.listenToFamily(familyId);
        })
      )
      .subscribe(family => {
        this.familyName = family?.name || this.i18n.translate('chat.titleDefault');
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.langSub?.unsubscribe();
  }

  private updateOtherParentName() {
    const meta = this.calendarService.getParentMetadataSnapshot();
    const others = [meta.parent1, meta.parent2].filter(p => p.uid && p.uid !== this.currentUserId);
    const mine = [meta.parent1, meta.parent2].find(p => p.uid === this.currentUserId);

    this.otherParentName = others[0]?.name || 'הורה';
    this.currentUserName = mine?.name || this.currentUserName;
  }

  async sendMessage() {
    const trimmed = this.messageText.trim();

    if (!trimmed || !this.familyId || !this.currentUserId) {
      return;
    }

    this.isSending = true;

    try {
      await this.chatService.sendMessage(this.familyId, trimmed, {
        id: this.currentUserId,
        name: this.currentUserName
      });
      this.messageText = '';
    } catch (error) {
      console.error('Failed to send message', error);
    } finally {
      this.isSending = false;
    }
  }

  formatTime(date: Date | undefined): string {
    if (!date) {
      return '';
    }
    return this.i18n.formatTime(date);
  }

  isOutgoing(message: ChatMessage): boolean {
    return message.senderId === this.currentUserId;
  }

  getInitial(message: ChatMessage): string {
    const isMine = this.isOutgoing(message);
    const name = isMine
      ? this.currentUserName || this.i18n.translate('chat.me')
      : message.senderName || this.otherParentName || this.i18n.translate('chat.parent');
    return name.trim().charAt(0).toUpperCase();
  }

  getAvatarUrl(message: ChatMessage): string | null {
    const meta = this.calendarService.getParentMetadataSnapshot();
    if (message.senderId === meta.parent1.uid) {
      return meta.parent1.photoUrl || null;
    }
    if (message.senderId === meta.parent2.uid) {
      return meta.parent2.photoUrl || null;
    }
    // if it's me but metadata not matched
    if (message.senderId === this.currentUserId && this.currentUserName) {
      return meta.parent1.uid === this.currentUserId ? meta.parent1.photoUrl || null : meta.parent2.photoUrl || null;
    }
    return null;
  }

  private resetFallbackLabels() {
    const prevMe = this.defaultMe;
    const prevParent = this.defaultParent;
    const prevTitle = this.defaultChatTitle;

    this.defaultMe = this.i18n.translate('chat.me');
    this.defaultParent = this.i18n.translate('chat.parent');
    this.defaultChatTitle = this.i18n.translate('chat.titleDefault');

    if (!this.currentUserName || this.currentUserName === prevMe) {
      this.currentUserName = this.defaultMe;
    }
    if (!this.otherParentName || this.otherParentName === prevParent) {
      this.otherParentName = this.defaultParent;
    }
    if (!this.familyName || this.familyName === prevTitle) {
      this.familyName = this.defaultChatTitle;
    }
  }
}
