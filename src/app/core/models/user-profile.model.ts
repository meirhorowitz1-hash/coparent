export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  phone?: string | null;
  families?: string[];
  activeFamilyId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}
