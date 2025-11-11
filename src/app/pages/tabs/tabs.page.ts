import { Component } from '@angular/core';
import { addIcons } from 'ionicons';
import { homeOutline, calendarOutline, cashOutline, listOutline, personOutline } from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  standalone: false
})
export class TabsPage {
  constructor() {
    addIcons({ homeOutline, calendarOutline, cashOutline, listOutline, personOutline });
  }
}
