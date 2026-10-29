// Shapes returned by administration, alerts, documents, uploads and reports endpoints.
import { NameCount, UserType } from './models';
import { OpportunityStage } from './sales-models';

export interface UserListItem {
  id: number;
  loginName: string;
  name: string;
  email: string;
  mobile: string | null;
  role: string;
  type: UserType;
  dealer: string | null;
  zones: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface UserDetail {
  id: number;
  loginName: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string | null;
  roleId: number;
  type: UserType;
  dealerId: number | null;
  designationId: number | null;
  zoneIds: number[];
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  legacySource: string | null;
  createdAt: string;
}

export interface DealerListItem {
  id: number;
  name: string;
  zone: string;
  mobile: string | null;
  email: string | null;
  users: number;
  customers: number;
  isActive: boolean;
}

export interface DealerDetail {
  id: number;
  name: string;
  description: string | null;
  zoneId: number;
  zone: string;
  address: string | null;
  mobile: string | null;
  email: string | null;
  pan: string | null;
  gstn: string | null;
  isActive: boolean;
}

export type AlertType =
  | 'OpportunityStatus' | 'PasswordReset' | 'Manual' | 'Welcome' | 'LeadAssigned' | 'OpportunityAssigned' | 'FollowUpOverdue'
  | 'QuotationSubmitted' | 'QuotationDecided' | 'TransferRequested' | 'TransferDecided' | 'ServiceReminder' | 'UpcomingService'
  | 'PostCommissioning' | 'WarrantyExpiring' | 'AmcExpiring' | 'JobAssigned' | 'JobCompleted' | 'UploadResult';

export interface NotificationItem {
  id: number;
  type: AlertType;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface AlertSettingItem {
  type: AlertType;
  label: string;
  when: string;
  recipients: string;
  mandatory: boolean;
  enabled: boolean;
  sendEmail: boolean;
}

export type EmailStatus = 'Pending' | 'Sent' | 'Failed';

export interface EmailItem {
  id: number;
  to: string;
  subject: string;
  type: AlertType;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface EmailDetail extends EmailItem {
  body: string;
}

export interface RecipientOption {
  id: number;
  name: string;
  role: string;
  dealer: string | null;
}

export type DocumentOwner = 'Customer' | 'Asset' | 'Opportunity' | 'Quotation' | 'Commissioning' | 'ServiceJob';

export interface DocumentItem {
  id: number;
  ownerType: DocumentOwner;
  ownerId: number;
  customerId: number;
  customer: string;
  documentTypeId: number | null;
  documentType: string | null;
  title: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
  viewable: boolean;
  canDownload: boolean;
  canRemove: boolean;
}

export interface UploadKind {
  key: string;
  title: string;
  description: string;
  columns: { header: string; required: boolean; hint: string }[];
}

export interface UploadResult {
  batchId: number;
  kind: string;
  rows: number;
  saved: number;
  failed: number;
  errors: { row: number; column: string; message: string }[];
}

export interface UploadBatchItem {
  id: number;
  kind: string;
  fileName: string;
  uploadedBy: string | null;
  at: string;
  rows: number;
  saved: number;
  failed: number;
}

export type ColumnType = 'Text' | 'Number' | 'Money' | 'Date' | 'Percent';

export interface ReportDefinition {
  key: string;
  title: string;
  group: string;
  description: string;
  filters: string[];
}

export interface ReportTable {
  key: string;
  title: string;
  subtitle: string;
  columns: { label: string; type: ColumnType }[];
  rows: (string | number | null)[][];
  totals: (string | number | null)[] | null;
}

export interface WorkItem {
  kind: string;
  title: string;
  detail: string;
  link: string;
  due: string | null;
}

export interface WorkSummary {
  fiscalYear: string;
  sales: {
    openLeads: number;
    openOpportunities: number;
    pipelineValue: number;
    wonCount: number;
    wonValue: number;
    targetValue: number;
    quotationsAwaiting: number;
    followUpsOverdue: number;
    awaitingAcceptance: number;
    byStage: { stage: OpportunityStage; count: number; value: number }[];
    wonByMonth: { month: string; count: number; value: number }[];
  } | null;
  service: {
    assets: number;
    openJobs: number;
    highPriorityJobs: number;
    remindersDue: number;
    warrantyEnding: number;
    amcEnding: number;
    commissioningOpen: number;
    jobsByStatus: NameCount[];
  } | null;
  myWork: WorkItem[];
}
