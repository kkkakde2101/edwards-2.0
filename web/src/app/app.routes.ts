import { Routes } from '@angular/router';
import { authGuard, guestGuard, permissionGuard } from './core/guards';
import { P } from './core/models';
import { Shell } from './layout/shell';

// Every page inside the shell checks its own permission; the API checks it again on each call.
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · Edwards',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    title: 'Forgot password · Edwards',
    loadComponent: () => import('./pages/login/password-reset').then((m) => m.ForgotPassword),
  },
  {
    path: 'reset-password',
    title: 'Choose a password · Edwards',
    loadComponent: () => import('./pages/login/password-reset').then((m) => m.ResetPassword),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        canActivate: [permissionGuard(P.dashboardView)],
        title: 'Dashboard · Edwards',
        loadComponent: () => import('./pages/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'customers',
        canActivate: [permissionGuard(P.customersView)],
        title: 'Customers · Edwards',
        loadComponent: () => import('./pages/customers/customer-list').then((m) => m.CustomerList),
      },
      {
        path: 'customers/new',
        canActivate: [permissionGuard(P.customersCreate)],
        title: 'Create customer · Edwards',
        loadComponent: () => import('./pages/customers/customer-form').then((m) => m.CustomerForm),
      },
      {
        path: 'customers/:id',
        canActivate: [permissionGuard(P.customersView)],
        title: 'Customer · Edwards',
        loadComponent: () => import('./pages/customers/customer-detail').then((m) => m.CustomerDetail),
      },
      {
        path: 'customers/:id/edit',
        canActivate: [permissionGuard(P.customersEdit)],
        title: 'Edit customer · Edwards',
        loadComponent: () => import('./pages/customers/customer-form').then((m) => m.CustomerForm),
      },
      // ---- Sales ----
      {
        path: 'visits',
        canActivate: [permissionGuard(P.visitsView)],
        title: 'Visits · Edwards',
        loadComponent: () => import('./pages/sales/visits').then((m) => m.VisitList),
      },
      {
        path: 'visits/new',
        canActivate: [permissionGuard(P.visitsCreate)],
        title: 'Record visit · Edwards',
        loadComponent: () => import('./pages/sales/visits').then((m) => m.VisitForm),
      },
      {
        path: 'visits/:id',
        canActivate: [permissionGuard(P.visitsView)],
        title: 'Visit · Edwards',
        loadComponent: () => import('./pages/sales/visits').then((m) => m.VisitView),
      },
      {
        path: 'visits/:id/edit',
        canActivate: [permissionGuard(P.visitsEdit)],
        title: 'Edit visit · Edwards',
        loadComponent: () => import('./pages/sales/visits').then((m) => m.VisitForm),
      },
      {
        path: 'leads',
        canActivate: [permissionGuard(P.leadsView)],
        title: 'Leads · Edwards',
        loadComponent: () => import('./pages/sales/leads').then((m) => m.LeadList),
      },
      {
        path: 'leads/:id',
        canActivate: [permissionGuard(P.leadsView)],
        title: 'Lead · Edwards',
        loadComponent: () => import('./pages/sales/leads').then((m) => m.LeadView),
      },
      {
        path: 'opportunities',
        canActivate: [permissionGuard(P.opportunitiesView)],
        title: 'Opportunities · Edwards',
        loadComponent: () => import('./pages/sales/opportunities').then((m) => m.OpportunityList),
      },
      {
        path: 'opportunities/new',
        canActivate: [permissionGuard(P.opportunitiesCreate)],
        title: 'Add opportunity · Edwards',
        loadComponent: () => import('./pages/sales/opportunities').then((m) => m.OpportunityNew),
      },
      {
        path: 'opportunities/:id',
        canActivate: [permissionGuard(P.opportunitiesView)],
        title: 'Opportunity · Edwards',
        loadComponent: () => import('./pages/sales/opportunities').then((m) => m.OpportunityView),
      },
      {
        path: 'transfers',
        canActivate: [permissionGuard(P.transfersView)],
        title: 'Customer transfers · Edwards',
        loadComponent: () => import('./pages/sales/transfers').then((m) => m.Transfers),
      },
      {
        path: 'targets',
        canActivate: [permissionGuard(P.targetsView)],
        title: 'Dealer targets · Edwards',
        loadComponent: () => import('./pages/sales/targets').then((m) => m.Targets),
      },
      // ---- Service ----
      {
        path: 'assets',
        canActivate: [permissionGuard(P.assetsView)],
        title: 'Assets · Edwards',
        loadComponent: () => import('./pages/service/assets').then((m) => m.AssetList),
      },
      {
        path: 'assets/new',
        canActivate: [permissionGuard(P.assetsCreate)],
        title: 'Register asset · Edwards',
        loadComponent: () => import('./pages/service/assets').then((m) => m.AssetForm),
      },
      {
        path: 'assets/:id',
        canActivate: [permissionGuard(P.assetsView)],
        title: 'Asset · Edwards',
        loadComponent: () => import('./pages/service/assets').then((m) => m.AssetView),
      },
      {
        path: 'assets/:id/edit',
        canActivate: [permissionGuard(P.assetsEdit)],
        title: 'Edit asset · Edwards',
        loadComponent: () => import('./pages/service/assets').then((m) => m.AssetForm),
      },
      {
        path: 'commissioning',
        canActivate: [permissionGuard(P.commissioningView)],
        title: 'Commissioning · Edwards',
        loadComponent: () => import('./pages/service/commissioning').then((m) => m.Commissioning),
      },
      {
        path: 'amc',
        canActivate: [permissionGuard(P.amcView)],
        title: 'Warranty and AMC · Edwards',
        loadComponent: () => import('./pages/service/amc').then((m) => m.Amc),
      },
      {
        path: 'jobs',
        canActivate: [permissionGuard(P.jobsView)],
        title: 'Service jobs · Edwards',
        loadComponent: () => import('./pages/service/jobs').then((m) => m.JobList),
      },
      {
        path: 'jobs/:id',
        canActivate: [permissionGuard(P.jobsView)],
        title: 'Service job · Edwards',
        loadComponent: () => import('./pages/service/jobs').then((m) => m.JobView),
      },
      {
        path: 'reminders',
        canActivate: [permissionGuard(P.remindersView)],
        title: 'Service reminders · Edwards',
        loadComponent: () => import('./pages/service/reminders').then((m) => m.Reminders),
      },
      // ---- Shared ----
      {
        path: 'reports',
        canActivate: [permissionGuard(P.reportsView)],
        title: 'Reports · Edwards',
        loadComponent: () => import('./pages/reports').then((m) => m.ReportList),
      },
      {
        path: 'reports/:key',
        canActivate: [permissionGuard(P.reportsView)],
        title: 'Report · Edwards',
        loadComponent: () => import('./pages/reports').then((m) => m.ReportView),
      },
      {
        path: 'alerts/send',
        canActivate: [permissionGuard(P.alertsSend)],
        title: 'Send alert · Edwards',
        loadComponent: () => import('./pages/alerts').then((m) => m.SendAlert),
      },
      {
        path: 'notifications',
        title: 'Notifications · Edwards',
        loadComponent: () => import('./pages/alerts').then((m) => m.Notifications),
      },
      // ---- Administration ----
      {
        path: 'admin/users',
        canActivate: [permissionGuard(P.usersView)],
        title: 'Users · Edwards',
        loadComponent: () => import('./pages/admin/users').then((m) => m.Users),
      },
      {
        path: 'admin/dealers',
        canActivate: [permissionGuard(P.dealersView)],
        title: 'Dealers · Edwards',
        loadComponent: () => import('./pages/admin/dealers').then((m) => m.Dealers),
      },
      {
        path: 'admin/upload',
        canActivate: [permissionGuard(P.uploadsRun)],
        title: 'Excel upload · Edwards',
        loadComponent: () => import('./pages/admin/upload').then((m) => m.Upload),
      },
      {
        path: 'admin/alerts',
        canActivate: [permissionGuard(P.settingsView)],
        title: 'Alerts and email · Edwards',
        loadComponent: () => import('./pages/admin/alert-settings').then((m) => m.AlertSettings),
      },
      {
        path: 'admin/masters',
        canActivate: [permissionGuard(P.mastersView)],
        title: 'Masters · Edwards',
        loadComponent: () => import('./pages/admin/masters').then((m) => m.Masters),
      },
      {
        path: 'admin/masters/:key',
        canActivate: [permissionGuard(P.mastersView)],
        title: 'Masters · Edwards',
        loadComponent: () => import('./pages/admin/masters').then((m) => m.Masters),
      },
      {
        path: 'admin/roles',
        canActivate: [permissionGuard(P.rolesView)],
        title: 'Roles and permissions · Edwards',
        loadComponent: () => import('./pages/admin/roles').then((m) => m.Roles),
      },
      {
        path: 'admin/roles/:id',
        canActivate: [permissionGuard(P.rolesView)],
        title: 'Roles and permissions · Edwards',
        loadComponent: () => import('./pages/admin/roles').then((m) => m.Roles),
      },
      {
        path: 'change-password',
        title: 'Change password · Edwards',
        loadComponent: () => import('./pages/change-password').then((m) => m.ChangePassword),
      },
      {
        path: 'forbidden',
        title: 'Not allowed · Edwards',
        loadComponent: () => import('./pages/status-pages').then((m) => m.Forbidden),
      },
      {
        path: '**',
        title: 'Page not found · Edwards',
        loadComponent: () => import('./pages/status-pages').then((m) => m.NotFound),
      },
    ],
  },
];
