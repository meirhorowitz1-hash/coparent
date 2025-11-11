import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { CalendarPage } from './calendar.page';
import { EventFormComponent } from './event-form.component';
import { CustodySetupComponent } from './custody-setup.component';

const routes: Routes = [
  {
    path: '',
    component: CalendarPage
  }
];

@NgModule({
  declarations: [CalendarPage, EventFormComponent, CustodySetupComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    RouterModule.forChild(routes)
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class CalendarPageModule {}
