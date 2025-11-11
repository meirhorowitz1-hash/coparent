import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { HomePage } from './home.page';
import { SwapRequestModalComponent } from '../../components/swap-request-modal/swap-request-modal.component';

const routes: Routes = [
  {
    path: '',
    component: HomePage
  }
];

@NgModule({
  declarations: [HomePage, SwapRequestModalComponent],
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class HomePageModule {}
