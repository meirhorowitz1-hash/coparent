export interface SwapRequest {
  id: string;
  requestedBy: string;
  requestedByName: string;
  requestedTo: string;
  requestedToName: string;
  originalDate: Date;
  proposedDate?: Date | null;
  requestType: SwapRequestType;
  reason?: string;
  status: SwapRequestStatus;
  createdAt: Date;
  respondedAt?: Date;
  responseNote?: string;
}

export type SwapRequestType = 'swap' | 'one-way';

export enum SwapRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled'
}
