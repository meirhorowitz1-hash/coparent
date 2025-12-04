export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  phone?: string | null;
  families?: string[];
  ownedFamilyId?: string | null;
  activeFamilyId?: string | null;
  photoUrl?: string | null;
  calendarColor?: string | null;
  pushTokens?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}
