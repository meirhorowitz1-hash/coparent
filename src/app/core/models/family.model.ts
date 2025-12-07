export interface FamilyInvite {
  email: string;
  displayEmail: string;
  invitedBy: string;
  invitedByName?: string;
  status: 'pending' | 'accepted';
  createdAt: number;
}

export interface Family {
  id?: string;
  ownerId?: string;
  members: string[];
  pendingInvites: FamilyInvite[];
  pendingInviteEmails: string[];
  name?: string;
  photoUrl?: string | null;
  children?: string[];
  shareCode?: string | null;
  shareCodeUpdatedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}
