import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('./pages/signup/signup.page').then(m => m.SignupPage),
  },
  {
    path: 'tabs',
    loadComponent: () =>
      import('./pages/tabs/tabs.page').then(m => m.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('./pages/home/home.page').then(m => m.HomePage),
      },
      {
        path: 'calendar',
        loadComponent: () =>
          import('./pages/calendar/calendar.page').then(m => m.CalendarPage),
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./pages/expenses/expenses.page').then(m => m.ExpensesPage),
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('./pages/tasks/tasks.page').then(m => m.TasksPage),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./pages/documents/documents.page').then(m => m.DocumentsPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile/profile.page').then(m => m.ProfilePage),
      },
      {
        path: '',
        redirectTo: '/tabs/home',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
