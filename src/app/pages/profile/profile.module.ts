import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { ProfilePage } from './profile.page';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [
  {
    path: '',
    component: ProfilePage
  }
];

@NgModule({
  declarations: [ProfilePage],
  imports: [CommonModule, ReactiveFormsModule, IonicModule, SharedModule, RouterModule.forChild(routes)],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class ProfilePageModule {}
