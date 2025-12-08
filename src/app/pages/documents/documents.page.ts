import { Component, OnDestroy, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { DocumentItem } from '../../core/models/document.model';
import { DocumentService } from '../../core/services/document.service';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-documents',
  templateUrl: './documents.page.html',
  styleUrls: ['./documents.page.scss'],
  standalone: false
})
export class DocumentsPage implements OnInit, OnDestroy {
  documents: DocumentItem[] = [];
  title = '';
  selectedFile: File | null = null;
  selectedFileName = '';
  selectedChildId: string | null = null;
  searchTerm = '';
  childFilter: 'all' | 'none' | string = 'all';
  children: string[] = [];
  showUploadModal = false;

  private documentsSub?: Subscription;
  private childrenSub?: Subscription;

  constructor(
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private documentService: DocumentService,
    private i18n: I18nService
  ) {}

  ngOnInit(): void {
    this.documentsSub = this.documentService.documents$.subscribe(docs => {
      this.documents = docs;
    });
    this.childrenSub = this.documentService.children$.subscribe(children => {
      this.children = children ?? [];
    });
  }

  ngOnDestroy(): void {
    this.documentsSub?.unsubscribe();
    this.childrenSub?.unsubscribe();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.selectedFile = file || null;
    this.selectedFileName = file?.name || '';
  }

  async uploadDocument() {
    if (!this.selectedFile || !this.title.trim()) {
      await this.presentToast(this.i18n.translate('documents.toast.missingFields'), 'warning');
      return;
    }

    try {
      await this.documentService.uploadDocument(this.title, this.selectedFile, this.selectedChildId);
      this.resetForm();
      this.showUploadModal = false;
      await this.presentToast(this.i18n.translate('documents.toast.saved'), 'success');
    } catch (error: any) {
      console.error('Document upload failed', error);
      const message =
        error?.message === 'file-too-large'
          ? this.i18n.translate('documents.toast.large')
          : this.i18n.translate('documents.toast.failed');
      await this.presentToast(message, 'danger');
    }
  }

  openDocument(doc: DocumentItem) {
    const raw = doc.downloadUrl || doc.dataUrl;
    if (!raw) {
      return;
    }
    const url = this.dataUrlToObjectUrl(raw) || raw;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async confirmDelete(doc: DocumentItem) {
    const alert = await this.alertCtrl.create({
      header: this.i18n.translate('documents.delete.title'),
      message: this.i18n.translate('documents.delete.message', { title: doc.title }),
      buttons: [
        {
          text: this.i18n.translate('documents.delete.cancel'),
          role: 'cancel'
        },
        {
          text: this.i18n.translate('documents.delete.confirm'),
          handler: () => this.deleteDocument(doc)
        }
      ]
    });
    await alert.present();
  }

  private async deleteDocument(doc: DocumentItem) {
    try {
      await this.documentService.deleteDocument(doc.id);
      await this.presentToast(this.i18n.translate('documents.toast.deleted'), 'success');
    } catch (error) {
      console.error('Failed to delete document', error);
      await this.presentToast(this.i18n.translate('documents.toast.deleteFailed'), 'danger');
    }
  }

  get filteredDocuments(): DocumentItem[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.documents.filter(doc => {
      const matchesTerm =
        !term ||
        doc.title.toLowerCase().includes(term) ||
        doc.fileName.toLowerCase().includes(term);
      const matchesChild =
        this.childFilter === 'all'
          ? true
          : this.childFilter === 'none'
            ? !doc.childId
            : doc.childId === this.childFilter;
      return matchesTerm && matchesChild;
    });
  }

  formatDate(date: Date): string {
    return this.i18n.formatDate(date, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  openUploadModal() {
    this.resetForm();
    this.showUploadModal = true;
  }

  closeUploadModal() {
    this.showUploadModal = false;
  }

  private resetForm() {
    this.title = '';
    this.selectedFile = null;
    this.selectedFileName = '';
    this.selectedChildId = null;
  }

  private dataUrlToObjectUrl(dataUrl: string): string | null {
    if (!dataUrl.startsWith('data:')) {
      return null;
    }
    const parts = dataUrl.split(',');
    if (parts.length < 2) {
      return null;
    }
    try {
      const mime = parts[0].split(':')[1].split(';')[0] || 'application/octet-stream';
      const byteString = atob(parts[1]);
      const arrayBuffer = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(arrayBuffer);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([arrayBuffer], { type: mime });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Failed to convert data URL', error);
      return null;
    }
  }

  private async presentToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  getChildLabel(childId?: string | null): string {
    if (!childId) {
      return this.i18n.translate('documents.childLabel.none');
    }
    return childId;
  }

  private async loadChildren() {
    this.children = await this.documentService.getFamilyChildren();
  }
}
