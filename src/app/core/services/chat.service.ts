import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  orderBy,
  query,
  serverTimestamp,
  Timestamp
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

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

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly firestore = inject(Firestore);

  listenToMessages(familyId: string | null): Observable<ChatMessage[]> {
    if (!familyId) {
      return of([]);
    }

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

  async sendMessage(familyId: string, text: string, sender: { id: string; name?: string }): Promise<void> {
    if (!familyId || !text.trim() || !sender.id) {
      throw new Error('missing-chat-context');
    }

    const messagesRef = collection(this.firestore, 'families', familyId, 'messages');
    await addDoc(messagesRef, {
      text: text.trim(),
      senderId: sender.id,
      senderName: sender.name || 'הורה',
      sentAt: serverTimestamp()
    });
  }
}
