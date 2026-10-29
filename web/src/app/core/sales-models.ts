// Shapes returned by the sales endpoints (see Edwards.Api/Features/Sales and Features/Dealers).

export interface CompetitorLine {
  competitionMakeId: number | null;
  competitionMake?: string | null;
  model: string | null;
  quantity: number | null;
  working: number | null;
  standby: number | null;
  pumpTechnologyId: number | null;
  pumpTechnology?: string | null;
}

export interface VisitListItem {
  id: number;
  visitDate: string;
  visitType: string;
  customerId: number;
  customer: string;
  dealer: string;
  dealerUser: string | null;
  application: string | null;
  hasPotential: boolean;
  leadType: string | null;
  productRange: string | null;
  leadId: number | null;
  lead: string | null;
  competitors: number;
}

export interface VisitDetail {
  id: number;
  visitDate: string;
  visitTypeId: number;
  visitType: string;
  customerId: number;
  customer: string;
  dealerId: number;
  dealer: string;
  dealerUserId: number | null;
  dealerUser: string | null;
  applicationId: number | null;
  application: string | null;
  customerProduct: string | null;
  hasPotential: boolean;
  leadTypeId: number | null;
  leadType: string | null;
  productRangeId: number | null;
  productRange: string | null;
  productModelId: number | null;
  productModel: string | null;
  remark: string | null;
  leadId: number | null;
  lead: string | null;
  competitors: CompetitorLine[];
  createdAt: string;
}

export interface VisitInput {
  visitDate: string;
  visitTypeId: number | null;
  customerId: number | null;
  dealerUserId: number | null;
  applicationId: number | null;
  customerProduct: string | null;
  hasPotential: boolean;
  leadTypeId: number | null;
  productRangeId: number | null;
  productModelId: number | null;
  remark: string | null;
  leadId: number | null;
  competitors: CompetitorLine[];
}

export type LeadStatus = 'New' | 'Qualified' | 'Converted' | 'Disqualified';
export type LeadSource = 'Visit' | 'Manual' | 'Reminder' | 'Upload' | 'Enquiry';

export interface LeadListItem {
  id: number;
  name: string;
  customerId: number;
  customer: string;
  source: LeadSource;
  status: LeadStatus;
  dealer: string | null;
  dealerUser: string | null;
  owner: string | null;
  productRange: string | null;
  createdAt: string;
  opportunityId: number | null;
}

export interface LeadDetail {
  id: number;
  name: string;
  customerId: number;
  customer: string;
  source: LeadSource;
  status: LeadStatus;
  visitId: number | null;
  dealerId: number | null;
  dealer: string | null;
  dealerUserId: number | null;
  dealerUser: string | null;
  ownerUserId: number | null;
  owner: string | null;
  productRangeId: number | null;
  productRange: string | null;
  productModelId: number | null;
  productModel: string | null;
  remark: string | null;
  disqualifyReason: string | null;
  opportunityId: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export type OpportunityType = 'Equipment' | 'Spare' | 'Service';
export type OpportunityStage = 'Open' | 'Won' | 'Lost' | 'Postponed' | 'Dropped';

export interface OpportunityListItem {
  id: number;
  name: string;
  type: OpportunityType;
  stage: OpportunityStage;
  customerId: number;
  customer: string;
  dealer: string;
  dealerUser: string | null;
  owner: string | null;
  value: number;
  expectedCloseDate: string | null;
  salesPhase: string | null;
  chance: number | null;
  nextFollowUpDate: string | null;
  dealerAccepted: boolean;
}

export type FollowUpMode = 'Visit' | 'Call' | 'Email' | 'Meeting' | 'Other';

export interface FollowUpItem {
  id: number;
  date: string;
  mode: FollowUpMode;
  remark: string;
  nextDate: string | null;
  by: string | null;
  createdAt: string;
}

export interface OpportunityActions {
  edit: boolean;
  assign: boolean;
  accept: boolean;
  changeStatus: boolean;
  reopen: boolean;
  quote: boolean;
  approveQuote: boolean;
}

export interface OpportunityDetail {
  id: number;
  name: string;
  type: OpportunityType;
  source: 'Lead' | 'Manual' | 'Reminder';
  stage: OpportunityStage;
  customerId: number;
  customer: string;
  leadId: number | null;
  assetId: number | null;
  asset: string | null;
  dealerId: number;
  dealer: string;
  dealerUserId: number | null;
  dealerUser: string | null;
  ownerUserId: number | null;
  owner: string | null;
  dealerAccepted: boolean;
  acceptedAt: string | null;
  salesPhaseId: number | null;
  salesPhase: string | null;
  winningChanceId: number | null;
  winningChance: string | null;
  opportunityModeId: number | null;
  opportunityMode: string | null;
  expectedCloseDate: string | null;
  value: number;
  competitionPrice: number | null;
  winningReasonId: number | null;
  winningReason: string | null;
  losingReasonId: number | null;
  losingReason: string | null;
  poNumber: string | null;
  poDate: string | null;
  closedDate: string | null;
  closeRemark: string | null;
  nextFollowUpDate: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string | null;
  followUps: FollowUpItem[];
  actions: OpportunityActions | null;
}

export interface OpportunityInput {
  name: string;
  type: OpportunityType;
  customerId: number | null;
  assetId: number | null;
  dealerUserId: number | null;
  ownerUserId: number | null;
  salesPhaseId: number | null;
  winningChanceId: number | null;
  opportunityModeId: number | null;
  expectedCloseDate: string | null;
  competitionPrice: number | null;
  remark: string | null;
}

export type QuotationStatus = 'Draft' | 'Submitted' | 'Revised' | 'Accepted' | 'Rejected';
export type LineType = 'Equipment' | 'Spare' | 'Service';

export interface QuotationLine {
  id?: number;
  type: LineType;
  productRangeId: number | null;
  productRange?: string | null;
  productModelId: number | null;
  productModel?: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
}

export interface QuotationItem {
  id: number;
  opportunityId: number;
  revision: number;
  number: string;
  quoteDate: string;
  status: QuotationStatus;
  total: number;
  remark: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionRemark: string | null;
  lines: QuotationLine[];
}

export type TransferStatus = 'Pending' | 'Approved' | 'Rejected';

export interface TransferItem {
  id: number;
  customerId: number;
  customer: string;
  fromDealerId: number;
  fromDealer: string;
  toDealerId: number;
  toDealer: string;
  toDealerUser: string | null;
  reason: string;
  effectiveDate: string;
  status: TransferStatus;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  appliedAt: string | null;
}

export interface RangeTarget {
  productRangeId: number;
  productRange: string;
  targetQuantity: number;
  targetValue: number;
  achievedQuantity: number;
  achievedValue: number;
}

export interface DealerTargetRow {
  dealerId: number;
  dealer: string;
  zone: string;
  targetValue: number;
  achievedValue: number;
  wonCount: number;
  ranges: RangeTarget[];
}

export interface TargetSheet {
  fiscalYear: number;
  label: string;
  dealers: DealerTargetRow[];
}

export const STAGE_PILL: Record<OpportunityStage, string> = {
  Open: 'pill-info',
  Postponed: 'pill-warn',
  Won: 'pill-active',
  Lost: 'pill-red',
  Dropped: 'pill-inactive',
};

export const LEAD_PILL: Record<LeadStatus, string> = {
  New: 'pill-info',
  Qualified: 'pill-warn',
  Converted: 'pill-active',
  Disqualified: 'pill-inactive',
};

export const QUOTE_PILL: Record<QuotationStatus, string> = {
  Draft: 'pill-inactive',
  Submitted: 'pill-warn',
  Revised: 'pill-inactive',
  Accepted: 'pill-active',
  Rejected: 'pill-red',
};
