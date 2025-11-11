import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { DocumentsPage } from './documents.page';

const routes: Routes = [
  {
    path: '',
    component: DocumentsPage
  }
];

@NgModule({
  declarations: [DocumentsPage],
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class DocumentsPageModule {}
