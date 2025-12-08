import { Injectable, inject, OnDestroy } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

export interface SocketEvent<T = unknown> {
  event: string;
  data: T;
}

/**
 * Socket.io Service for real-time updates from the backend
 */
@Injectable({
  providedIn: 'root'
})
export class SocketService implements OnDestroy {
  private auth = inject(Auth);
  private socket: Socket | null = null;
  
  private connected$ = new BehaviorSubject<boolean>(false);
  private events$ = new Subject<SocketEvent>();
  
  private currentFamilyId: string | null = null;

  /**
   * Check if socket is connected
   */
  get isConnected$(): Observable<boolean> {
    return this.connected$.asObservable();
  }

  /**
   * Get all socket events as observable
   */
  get allEvents$(): Observable<SocketEvent> {
    return this.events$.asObservable();
  }

  /**
   * Connect to socket server
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) {
      console.log('[Socket] Already connected');
      return;
    }

    const user = this.auth.currentUser;
    if (!user) {
      console.warn('[Socket] Cannot connect - not authenticated');
      return;
    }

    console.log('[Socket] Connecting to:', environment.socketUrl);
    const token = await user.getIdToken();
    
    this.socket = io(environment.socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.setupListeners();
  }

  /**
   * Disconnect from socket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected$.next(false);
      this.currentFamilyId = null;
    }
  }

  /**
   * Join a family room for real-time updates
   */
  joinFamily(familyId: string): void {
    console.log('[Socket] joinFamily called with:', familyId, 'connected:', this.socket?.connected);
    
    if (!familyId) {
      console.warn('[Socket] Cannot join family - no familyId provided');
      return;
    }
    
    // Leave previous family if different
    if (this.currentFamilyId && this.currentFamilyId !== familyId && this.socket?.connected) {
      this.leaveFamily(this.currentFamilyId);
    }
    
    // Always save the familyId so we can join when connected
    this.currentFamilyId = familyId;
    
    if (!this.socket?.connected) {
      console.log('[Socket] Not connected yet, will join family when connected');
      // Connect if not already connecting
      this.connect();
      return;
    }

    this.socket.emit('join:family', familyId);
    console.log('[Socket] Joined family:', familyId);
  }

  /**
   * Leave a family room
   */
  leaveFamily(familyId: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('leave:family', familyId);
    if (this.currentFamilyId === familyId) {
      this.currentFamilyId = null;
    }
  }

  /**
   * Send typing indicator
   */
  sendTyping(familyId: string, isTyping: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit('chat:typing', { familyId, isTyping });
  }

  /**
   * Listen for specific event type
   */
  on<T>(event: string): Observable<T> {
    return new Observable<T>(observer => {
      const handler = (data: T) => observer.next(data);
      this.socket?.on(event, handler);
      
      return () => {
        this.socket?.off(event, handler);
      };
    });
  }

  /**
   * Setup socket event listeners
   */
  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('[Socket] Connected');
      this.connected$.next(true);
      
      // Rejoin family if we have one
      if (this.currentFamilyId) {
        console.log('[Socket] Rejoining family after connect:', this.currentFamilyId);
        this.socket!.emit('join:family', this.currentFamilyId);
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      this.connected$.next(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error);
      this.connected$.next(false);
    });

    // Forward all events through the events$ subject
    const eventTypes = [
      'chat:message',
      'chat:typing',
      'expense:created',
      'expense:updated',
      'expense:deleted',
      'task:created',
      'task:updated',
      'task:deleted',
      'event:created',
      'event:updated',
      'event:deleted',
      'swap:created',
      'swap:updated',
      'custody:updated',
      'custody:deleted',
      'document:created',
      'document:deleted',
    ];

    eventTypes.forEach(eventType => {
      this.socket?.on(eventType, (data) => {
        console.log('[Socket] Received event:', eventType, data);
        this.events$.next({ event: eventType, data });
      });
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
