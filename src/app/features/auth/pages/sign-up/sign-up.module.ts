import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { SignUpPage } from './sign-up.page';

const routes: Routes = [
  {
    path: '',
    component: SignUpPage
  }
];

@NgModule({
  declarations: [SignUpPage],
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule.forChild(routes)]
})
export class SignUpPageModule {}
