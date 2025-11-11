import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { SignInPage } from './sign-in.page';

const routes: Routes = [
  {
    path: '',
    component: SignInPage
  }
];

@NgModule({
  declarations: [SignInPage],
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule.forChild(routes)]
})
export class SignInPageModule {}
