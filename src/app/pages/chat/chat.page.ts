import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, of } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { ChatMessage, ChatService } from '../../core/services/chat.service';
import { CalendarService } from '../../core/services/calendar.service';
import { AuthService } from '../../core/services/auth.service';
import { FamilyService } from '../../core/services/family.service';
import { Family } from '../../core/models/family.model';

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
  currentUserName = 'אני';
  otherParentName = 'הורה';
  familyName = 'צ׳אט';

  private destroy$ = new Subject<void>();

  constructor(
    private chatService: ChatService,
    private calendarService: CalendarService,
    private authService: AuthService,
    private familyService: FamilyService
  ) {}

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
          this.familyName = 'צ׳אט';
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
        this.familyName = family?.name || 'צ׳אט';
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  isOutgoing(message: ChatMessage): boolean {
    return message.senderId === this.currentUserId;
  }

  getInitial(message: ChatMessage): string {
    const isMine = this.isOutgoing(message);
    const name = isMine
      ? this.currentUserName || 'אני'
      : message.senderName || this.otherParentName || 'הורה';
    return name.trim().charAt(0).toUpperCase();
  }
}
