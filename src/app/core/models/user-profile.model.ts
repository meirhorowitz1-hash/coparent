export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  phone?: string | null;
  families?: string[];
  activeFamilyId?: string | null;
  pushTokens?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}
