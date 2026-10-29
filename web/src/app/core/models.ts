// Shapes returned by the Edwards API (see Edwards.Api/Features).

export type DataScope = 'All' | 'Zone' | 'Dealer' | 'Own';

export const SCOPE_LABELS: Record<DataScope, string> = {
  All: 'All records',
  Zone: 'Records in their zones',
  Dealer: "Their dealer's records",
  Own: 'Only records assigned to them',
};

/** Permission keys checked by the API. Keep in sync with Edwards.Api/Auth/Permissions.cs. */
export const P = {
  dashboardView: 'dashboard.view',
  customersView: 'customers.view',
  customersCreate: 'customers.create',
  customersEdit: 'customers.edit',
  customersDeactivate: 'customers.deactivate',
  transfersView: 'transfers.view',
  transfersRequest: 'transfers.request',
  transfersApprove: 'transfers.approve',
  visitsView: 'visits.view',
  visitsCreate: 'visits.create',
  visitsEdit: 'visits.edit',
  leadsView: 'leads.view',
  leadsCreate: 'leads.create',
  leadsEdit: 'leads.edit',
  opportunitiesView: 'opportunities.view',
  opportunitiesCreate: 'opportunities.create',
  opportunitiesEdit: 'opportunities.edit',
  opportunitiesAssign: 'opportunities.assign',
  opportunitiesReopen: 'opportunities.reopen',
  quotationsView: 'quotations.view',
  quotationsEdit: 'quotations.edit',
  quotationsApprove: 'quotations.approve',
  targetsView: 'targets.view',
  targetsEdit: 'targets.edit',
  assetsView: 'assets.view',
  assetsCreate: 'assets.create',
  assetsEdit: 'assets.edit',
  commissioningView: 'commissioning.view',
  commissioningEdit: 'commissioning.edit',
  amcView: 'amc.view',
  amcEdit: 'amc.edit',
  jobsView: 'jobs.view',
  jobsCreate: 'jobs.create',
  jobsEdit: 'jobs.edit',
  jobsAssign: 'jobs.assign',
  remindersView: 'reminders.view',
  remindersEdit: 'reminders.edit',
  documentsView: 'documents.view',
  documentsUpload: 'documents.upload',
  documentsDownload: 'documents.download',
  reportsView: 'reports.view',
  reportsExport: 'reports.export',
  alertsSend: 'alerts.send',
  uploadsRun: 'uploads.run',
  usersView: 'users.view',
  usersEdit: 'users.edit',
  dealersView: 'dealers.view',
  dealersEdit: 'dealers.edit',
  mastersView: 'masters.view',
  mastersEdit: 'masters.edit',
  rolesView: 'roles.view',
  rolesEdit: 'roles.edit',
  settingsView: 'settings.view',
  settingsEdit: 'settings.edit',
} as const;

export type UserType = 'Edwards' | 'Dealer' | 'DealerUser';

export const USER_TYPE_LABELS: Record<UserType, string> = { Edwards: 'Edwards staff', Dealer: 'Dealer principal', DealerUser: 'Dealer engineer' };

export interface MenuItem {
  label: string;
  icon: string;
  route: string | null;
  children?: MenuItem[] | null;
}

export interface Me {
  id: number;
  loginName: string;
  displayName: string;
  roleName: string;
  scope: DataScope;
  userType: UserType;
  dealerId: number | null;
  dealerName: string | null;
  mustChangePassword: boolean;
  permissions: string[];
  menu: MenuItem[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  mustChangePassword: boolean;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Option {
  id: number;
  name: string;
}

export interface DealerOption extends Option {
  zone: string;
  zoneId: number;
}

export interface CustomerListItem {
  id: number;
  name: string;
  city: string | null;
  district: string | null;
  state: string | null;
  pinCode: string;
  gst: string | null;
  segment: string;
  accountType: string;
  businessLine: string | null;
  dealer: string;
  dealerUser: string | null;
  contacts: number;
  customerDate: string;
  isActive: boolean;
}

export interface CustomerDetail {
  id: number;
  customerDate: string;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  stateId: number | null;
  state: string | null;
  pinCode: string;
  gst: string | null;
  segmentId: number;
  segment: string;
  accountTypeId: number;
  accountType: string;
  businessLineId: number | null;
  businessLine: string | null;
  dealerId: number;
  dealer: string;
  dealerUserId: number | null;
  dealerUser: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface CustomerInput {
  customerDate: string;
  name: string;
  address: string;
  city: string;
  district: string;
  stateId: number | null;
  pinCode: string;
  gst: string | null;
  segmentId: number | null;
  accountTypeId: number | null;
  businessLineId: number | null;
  dealerId: number | null;
  dealerUserId: number | null;
  confirmDuplicate: boolean;
}

export interface DuplicateMatch {
  id: number;
  name: string;
  gst: string | null;
  city: string | null;
  dealer: string;
}

export interface DuplicateWarning {
  code: 'duplicate';
  message: string;
  matches: DuplicateMatch[];
}

export interface ContactItem {
  id: number;
  personName: string;
  designation: string | null;
  email: string;
  mobile: string;
  landLine: string | null;
  reportingTo: string | null;
  department: string | null;
  isActive: boolean;
}

export type ContactInput = Omit<ContactItem, 'id' | 'isActive'>;

export interface MasterSummary {
  key: string;
  label: string;
  group: string;
  total: number;
  active: number;
  parentKey: string | null;
  numberLabel: string | null;
}

export interface MasterItem {
  id: number;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  parentId: number | null;
  parentName: string | null;
  number: number | null;
}

export interface MasterInput {
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  parentId: number | null;
  number: number | null;
}

export interface RoleSummary {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  scope: DataScope;
  isActive: boolean;
  users: number;
  permissions: number;
}

export interface RoleDetail {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  scope: DataScope;
  isActive: boolean;
  users: number;
  isLocked: boolean;
  permissionKeys: string[];
}

export interface PermissionModule {
  module: string;
  label: string;
  actions: { key: string; action: string; label: string }[];
}

export interface RoleInput {
  name: string;
  description: string | null;
  scope: DataScope;
  isActive: boolean;
  permissionKeys: string[];
}

export interface NameCount {
  name: string;
  count: number;
}

export interface DashboardSummary {
  activeCustomers: number;
  contacts: number;
  newLast30Days: number;
  missingCity: number;
  byBusinessLine: NameCount[];
  bySegment: NameCount[];
  recent: { id: number; name: string; city: string | null; dealer: string; customerDate: string }[];
}
