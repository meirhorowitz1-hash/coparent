import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { IonTabs } from '@ionic/angular';

type TabsDidChangeEventDetail = {
  tab?: string;
};
import { addIcons } from 'ionicons';
import {
  homeOutline,
  home,
  calendarOutline,
  calendar,
  cashOutline,
  cash,
  listOutline,
  list,
  timeOutline,
  time,
  personOutline,
  person
} from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  standalone: false
})
export class TabsPage implements AfterViewInit {
  @ViewChild(IonTabs, { static: true }) private ionTabs?: IonTabs;

  protected readonly tabs = [
    { id: 'home', label: 'בית', icon: 'home-outline', activeIcon: 'home' },
    { id: 'calendar', label: 'לוח שנה', icon: 'calendar-outline', activeIcon: 'calendar' },
    { id: 'expenses', label: 'הוצאות', icon: 'cash-outline', activeIcon: 'cash' },
    { id: 'history', label: 'היסטוריה', icon: 'time-outline', activeIcon: 'time' },
    { id: 'tasks', label: 'משימות', icon: 'list-outline', activeIcon: 'list' },
    { id: 'profile', label: 'פרופיל', icon: 'person-outline', activeIcon: 'person' }
  ];

  protected selectedTab = this.tabs[0].id;

  constructor() {
    addIcons({
      homeOutline,
      home,
      calendarOutline,
      calendar,
      cashOutline,
      cash,
      listOutline,
      list,
      timeOutline,
      time,
      personOutline,
      person
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const currentlySelected = await this.ionTabs?.getSelected();
    if (currentlySelected) {
      this.selectedTab = currentlySelected;
    }
  }

  protected onTabChange(event: TabsDidChangeEventDetail) {
    if (event?.tab) {
      this.selectedTab = event.tab;
    }
  }

  protected isSelected(tabId: string): boolean {
    return this.selectedTab === tabId;
  }
}
