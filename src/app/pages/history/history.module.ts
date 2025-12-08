import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';

import { HistoryPage } from './history.page';
import { SharedModule } from '../../shared/shared.module';
import { StorageUsageComponent } from '../../components/storage-usage/storage-usage.component';

const routes: Routes = [
  {
    path: '',
    component: HistoryPage
  }
];

@NgModule({
  declarations: [HistoryPage],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    StorageUsageComponent,
    RouterModule.forChild(routes)
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class HistoryPageModule {}
