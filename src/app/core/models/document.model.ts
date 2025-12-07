export interface DocumentItem {
  id: string;
  title: string;
  fileName: string;
  childId?: string | null;
  downloadUrl?: string;
  storagePath?: string;
  dataUrl?: string;
  uploadedAt: Date;
  uploadedBy?: string;
  uploadedByName?: string;
}
