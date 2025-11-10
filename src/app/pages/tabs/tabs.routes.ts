import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('../home/home.page').then(m => m.HomePage),
      },
      {
        path: 'calendar',
        loadComponent: () =>
          import('../calendar/calendar.page').then(m => m.CalendarPage),
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('../expenses/expenses.page').then(m => m.ExpensesPage),
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('../tasks/tasks.page').then(m => m.TasksPage),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('../documents/documents.page').then(m => m.DocumentsPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('../profile/profile.page').then(m => m.ProfilePage),
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      }
    ]
  }
];
