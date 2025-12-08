import { Injectable, inject, OnDestroy } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  limit as firestoreLimit
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable, Subscription, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { useServerBackend } from './backend-mode';

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  sentAt: Date;
}

type FirestoreChatMessage = {
  text: string;
  senderId: string;
  senderName?: string;
  sentAt: Timestamp;
};

// Server API types
interface ServerChatMessage {
  id: string;
  familyId: string;
  content: string;
  senderId: string;
  senderName?: string | null;
  sentAt: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService implements OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly apiService = inject(ApiService);
  private readonly socketService = inject(SocketService);

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private socketSubscription?: Subscription;
  private currentFamilyId: string | null = null;
  private typingSubject = new BehaviorSubject<{ oderId: string; isTyping: boolean } | null>(null);
  readonly typing$ = this.typingSubject.asObservable();

  ngOnDestroy(): void {
    this.socketSubscription?.unsubscribe();
  }

  // ==================== PUBLIC API ====================

  listenToMessages(familyId: string | null): Observable<ChatMessage[]> {
    if (!familyId) {
      return of([]);
    }

    if (useServerBackend()) {
      return this.listenToMessagesServer(familyId);
    }
    return this.listenToMessagesFirebase(familyId);
  }

  async sendMessage(familyId: string, text: string, sender: { id: string; name?: string }): Promise<void> {
    if (!familyId || !text.trim() || !sender.id) {
      throw new Error('missing-chat-context');
    }

    if (useServerBackend()) {
      return this.sendMessageServer(familyId, text, sender);
    }
    return this.sendMessageFirebase(familyId, text, sender);
  }

  sendTypingIndicator(familyId: string, isTyping: boolean): void {
    if (useServerBackend()) {
      this.socketService.sendTyping(familyId, isTyping);
    }
  }

  // ==================== SERVER BACKEND METHODS ====================

  private listenToMessagesServer(familyId: string): Observable<ChatMessage[]> {
    // Initial load
    if (this.currentFamilyId !== familyId) {
      this.currentFamilyId = familyId;
      this.loadMessagesFromServer(familyId);
      this.subscribeToServerEvents();
    }

    return this.messagesSubject.asObservable();
  }

  private async loadMessagesFromServer(familyId: string): Promise<void> {
    try {
      const messages = await this.apiService.get<ServerChatMessage[]>(
        `/chat/${familyId}/messages`,
        { limit: '100' }
      ).toPromise();

      const mapped = (messages || []).map(m => this.mapServerMessage(m));
      this.messagesSubject.next(mapped);
    } catch (error) {
      console.error('[Chat] Failed to load messages from server', error);
    }
  }

  private async sendMessageServer(familyId: string, text: string, sender: { id: string; name?: string }): Promise<void> {
    await this.apiService.post(`/chat/${familyId}/messages`, {
      content: text.trim(),
      senderName: sender.name || 'הורה'
    }).toPromise();
  }

  private subscribeToServerEvents(): void {
    this.socketSubscription?.unsubscribe();

    this.socketSubscription = this.socketService.allEvents$.subscribe(({ event, data }) => {
      if (event === 'chat:message') {
        const message = this.mapServerMessage(data as ServerChatMessage);
        const current = this.messagesSubject.value;
        
        // Avoid duplicates
        if (!current.some(m => m.id === message.id)) {
          this.messagesSubject.next([...current, message]);
        }
      } else if (event === 'chat:typing') {
        const { userId, isTyping } = data as { oderId: string; isTyping: boolean; userId: string };
        this.typingSubject.next({ oderId: userId, isTyping });
      }
    });
  }

  private mapServerMessage(data: ServerChatMessage): ChatMessage {
    return {
      id: data.id,
      text: data.content,
      senderId: data.senderId,
      senderName: data.senderName || undefined,
      sentAt: new Date(data.sentAt)
    };
  }

  // ==================== FIREBASE BACKEND METHODS ====================

  private listenToMessagesFirebase(familyId: string): Observable<ChatMessage[]> {
    const messagesRef = collection(this.firestore, 'families', familyId, 'messages');
    const messagesQuery = query(messagesRef, orderBy('sentAt', 'asc'));

    return collectionData(messagesQuery, { idField: 'id' }).pipe(
      map(data =>
        (data as FirestoreChatMessage[]).map(item => ({
          id: (item as any)['id'] ?? '',
          text: item.text,
          senderId: item.senderId,
          senderName: item.senderName,
          sentAt: item.sentAt?.toDate ? item.sentAt.toDate() : new Date()
        }))
      )
    );
  }

  private async sendMessageFirebase(familyId: string, text: string, sender: { id: string; name?: string }): Promise<void> {
    const messagesRef = collection(this.firestore, 'families', familyId, 'messages');
    await addDoc(messagesRef, {
      text: text.trim(),
      senderId: sender.id,
      senderName: sender.name || 'הורה',
      sentAt: serverTimestamp()
    });
  }
}
