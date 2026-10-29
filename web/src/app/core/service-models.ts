// Shapes returned by the service endpoints (see Edwards.Api/Features/Service).

export type Coverage = 'None' | 'Warranty' | 'WarrantyEnding' | 'Amc' | 'AmcEnding' | 'Expired';

export const COVERAGE_LABELS: Record<Coverage, string> = {
  None: 'No dates',
  Warranty: 'In warranty',
  WarrantyEnding: 'Warranty ending',
  Amc: 'Under AMC',
  AmcEnding: 'AMC ending',
  Expired: 'Not covered',
};

export const COVERAGE_PILL: Record<Coverage, string> = {
  None: 'pill-inactive',
  Warranty: 'pill-active',
  WarrantyEnding: 'pill-warn',
  Amc: 'pill-info',
  AmcEnding: 'pill-warn',
  Expired: 'pill-red',
};

export interface AssetListItem {
  id: number;
  serialNumber: string;
  model: string | null;
  range: string | null;
  customerId: number;
  customer: string;
  dealer: string;
  city: string;
  commissioningDate: string | null;
  warrantyEnd: string | null;
  amcEnd: string | null;
  coverage: Coverage;
  nextServiceDate: string | null;
  engineer: string | null;
  isActive: boolean;
}

export interface AssetEventItem {
  id: number;
  at: string;
  kind: string;
  text: string;
  link: string | null;
  by: string | null;
}

export interface AssetDetail {
  id: number;
  serialNumber: string;
  productRangeId: number | null;
  productRange: string | null;
  productModelId: number | null;
  productModel: string | null;
  description: string | null;
  customerId: number;
  customer: string;
  dealerId: number;
  dealer: string;
  siteName: string | null;
  city: string;
  pinCode: string;
  commissioningDate: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  amcEnd: string | null;
  coverage: Coverage;
  serviceIntervalMonths: number;
  lastServiceDate: string | null;
  nextServiceDate: string | null;
  engineerUserId: number | null;
  engineer: string | null;
  sourceOpportunityId: number | null;
  isActive: boolean;
  createdAt: string;
  timeline: AssetEventItem[];
  amc: { id: number; type: string | null; startDate: string; endDate: string; visitsPerYear: number; value: number | null; isActive: boolean }[];
  commissionings: { id: number; plannedDate: string; status: CommissioningStatus; completedDate: string | null; engineer: string | null }[];
  jobs: { id: number; number: string; problem: string; status: JobStatus; priority: JobPriority; createdAt: string }[];
  actions: { edit: boolean; raiseJob: boolean; addAmc: boolean; commission: boolean } | null;
}

export interface AssetInput {
  customerId: number | null;
  productRangeId: number | null;
  productModelId: number | null;
  serialNumber: string;
  description: string | null;
  siteName: string | null;
  city: string;
  pinCode: string;
  serviceIntervalMonths: number;
  engineerUserId: number | null;
  sourceOpportunityId: number | null;
  commissioningDate: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  lastServiceDate: string | null;
  nextServiceDate: string | null;
}

export type CommissioningStatus = 'Planned' | 'InProgress' | 'Completed' | 'OnHold';

export interface CommissioningItem {
  id: number;
  assetId: number;
  serialNumber: string;
  model: string | null;
  customerId: number;
  customer: string;
  city: string;
  plannedDate: string;
  engineerUserId: number | null;
  engineer: string | null;
  status: CommissioningStatus;
  completedDate: string | null;
  warrantyMonths: number;
  remark: string | null;
  canEdit: boolean;
}

export type AmcState = 'Upcoming' | 'Active' | 'Ending' | 'Expired' | 'Cancelled';

export interface AmcItem {
  id: number;
  assetId: number;
  serialNumber: string;
  model: string | null;
  customerId: number;
  customer: string;
  dealer: string;
  amcTypeId: number | null;
  amcType: string | null;
  startDate: string;
  endDate: string;
  visitsPerYear: number;
  value: number | null;
  remark: string | null;
  state: AmcState;
}

export type JobPriority = 'Low' | 'Medium' | 'High';
export type JobStatus = 'Open' | 'Assigned' | 'InProgress' | 'OnHold' | 'Completed' | 'Closed';
export type JobSource = 'Breakdown' | 'Reminder' | 'Opportunity' | 'Manual';
export type ServiceVisitType = 'Commissioning' | 'Installation' | 'PreventiveMaintenance' | 'Breakdown' | 'Amc' | 'Other';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  Open: 'Open', Assigned: 'Assigned', InProgress: 'In progress', OnHold: 'On hold', Completed: 'Completed', Closed: 'Closed',
};

export const JOB_STATUS_PILL: Record<JobStatus, string> = {
  Open: 'pill-info', Assigned: 'pill-info', InProgress: 'pill-warn', OnHold: 'pill-red', Completed: 'pill-active', Closed: 'pill-inactive',
};

export const VISIT_TYPE_LABELS: Record<ServiceVisitType, string> = {
  Commissioning: 'Commissioning', Installation: 'Installation', PreventiveMaintenance: 'Preventive maintenance', Breakdown: 'Breakdown',
  Amc: 'AMC visit', Other: 'Other',
};

export interface JobListItem {
  id: number;
  number: string;
  assetId: number;
  serialNumber: string;
  model: string | null;
  customerId: number;
  customer: string;
  city: string;
  problem: string;
  priority: JobPriority;
  status: JobStatus;
  source: JobSource;
  engineer: string | null;
  plannedDate: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface JobDetail extends JobListItem {
  dealer: string;
  siteName: string | null;
  engineerUserId: number | null;
  completionReport: string | null;
  reminderId: number | null;
  opportunityId: number | null;
  notes: { id: number; at: string; by: string | null; text: string; statusChangedTo: JobStatus | null }[];
  visits: { id: number; type: ServiceVisitType; visitDate: string; completed: boolean; engineer: string | null; remarks: string | null }[];
  actions: { edit: boolean; assign: boolean; start: boolean; hold: boolean; complete: boolean; close: boolean } | null;
}

export type ReminderStatus = 'Pending' | 'Contacted' | 'Converted' | 'Dismissed';

export interface ReminderItem {
  id: number;
  assetId: number;
  serialNumber: string;
  model: string | null;
  customerId: number;
  customer: string;
  dealer: string;
  city: string;
  dueDate: string;
  lastServiceDate: string | null;
  status: ReminderStatus;
  notes: string | null;
  dismissReason: string | null;
  opportunityId: number | null;
  serviceJobId: number | null;
  engineer: string | null;
  covered: boolean;
}
