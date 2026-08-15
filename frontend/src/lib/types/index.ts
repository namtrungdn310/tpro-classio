export type ClassType = "MONTHLY" | "COURSE";
export type ClassIdentityScheme = "LEGACY" | "ACADEMIC_YEAR" | "INTAKE";
export type ClassCategory = "GENERAL" | "SPECIALIZED" | "IELTS" | "CUSTOM";
export type ClassGradeMode = "GRADE" | "NONE";
export type ClassEducationLevel = "PRIMARY" | "MIDDLE" | "HIGH";
export type ClassEffectiveStatus =
  | "LEGACY"
  | "SCHEDULED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";
export type ClassScope =
  | "operational"
  | "active"
  | "enrollable"
  | "scheduled"
  | "completed"
  | "cancelled";

export type MakeupReasonCode = "TEACHER_UNAVAILABLE" | "CENTER_OPERATION" | "OTHER";
export type ExceptionStatus =
  | "MAKEUP_PENDING"
  | "MAKEUP_SCHEDULED"
  | "MAKEUP_COMPLETED"
  | "RESTORED"
  | "CANCELLED";
export type ExceptionDisplayStatus =
  | ExceptionStatus
  | "AWAITING_CONFIRMATION";
export type OccurrenceKind = "REGULAR" | "POSTPONED" | "MAKEUP";
export type MakeupErrorCode =
  | "CLASS_VERSION_CONFLICT"
  | "OCCURRENCE_NOT_FOUND"
  | "OCCURRENCE_ALREADY_ADJUSTED"
  | "INVALID_TRANSITION"
  | "MAKEUP_DURATION_MISMATCH"
  | "STAFF_SCHEDULE_CONFLICT"
  | "CLASS_SCHEDULE_CONFLICT"
  | "MAKEUP_NOT_FINISHED"
  | "UNRESOLVED_MAKEUPS"
  | "RESTORE_NOT_ALLOWED"
  | "STAFF_INACTIVE"
  | "REQUEST_ALREADY_PROCESSED";

export type ClassScheduleSlot = {
  day: "Thứ 2" | "Thứ 3" | "Thứ 4" | "Thứ 5" | "Thứ 6" | "Thứ 7" | "Chủ Nhật";
  start: string;
  end: string;
  teacher_ids?: string[];
  assistant_ids?: string[];
  id?: string;
  version?: number;
};

export type ClassSchedule = {
  text?: string;
  slots?: ClassScheduleSlot[];
} | null;

export type ClassScheduleAvailabilityConflict = {
  class_id: string;
  class_name: string;
  class_category: ClassCategory | null;
  grade_level: number | null;
  day: ClassScheduleSlot["day"];
  start: string;
  end: string;
  busy_teacher_ids: string[];
  busy_assistant_ids: string[];
};

export type ClassScheduleAvailabilityRequest = {
  class_id?: string | null;
  start_date: string;
  end_date: string;
  teacher_ids: string[];
  assistant_ids: string[];
};

export type ClassResponse = {
  id: string;
  name: string;
  type: ClassType;
  base_fee: number;
  billing_cycle_months: number;
  billing_cycle_weeks?: number | null;
  start_date: string | null;
  end_date: string | null;
  identity_scheme: ClassIdentityScheme;
  class_category: ClassCategory | null;
  grade_mode: ClassGradeMode | null;
  program_name: string | null;
  grade_level: number | null;
  education_level: ClassEducationLevel | null;
  academic_year_start: number | null;
  schedule: ClassSchedule;
  teacher_id: string | null;
  teacher_ids: string[];
  teacher_name: string | null;
  teacher_names: string[];
  assistant_ids: string[];
  assistant_names: string[];
  is_active: boolean;
  student_count: number;
  created_at: string;
  updated_at: string;
  version: number;
  display_name: string;
  primary_label: string;
  secondary_label: string | null;
  effective_status: ClassEffectiveStatus;
  can_edit_end_date: boolean;
  can_edit?: boolean;
  can_cancel?: boolean;
  can_view_history?: boolean;
  next_fee_due_date?: string | null;
  next_fee_due_state?: "OVERDUE" | "UPCOMING" | "NONE";
  cancelled_at?: string | null;
  unresolved_makeup_count?: number;
};

export type ClassOccurrence = {
  key: string;
  kind: OccurrenceKind;
  original_start_at: string;
  original_end_at: string;
  source_slot_key: string;
  teacher_ids: string[];
  assistant_ids: string[];
  exception_id: string | null;
  status: ExceptionDisplayStatus | null;
  replacement_start_at: string | null;
  replacement_end_at: string | null;
  adjustable: boolean;
  already_adjusted: boolean;
  passed: boolean;
};

export type ClassOccurrenceListResponse = {
  class_id: string;
  occurrences: ClassOccurrence[];
};

export type MakeupStaffSnapshot = {
  staff_id: string;
  role: "TEACHER" | "ASSISTANT";
  display_name: string;
  source_slot_key: string;
};

export type ClassSessionExceptionResponse = {
  id: string;
  adjustment_id: string;
  class_id: string;
  original_start_at: string;
  original_end_at: string;
  original_timezone: string;
  status: ExceptionStatus;
  display_status: ExceptionDisplayStatus;
  replacement_start_at: string | null;
  replacement_end_at: string | null;
  completed_at: string | null;
  restored_at: string | null;
  version: number;
  staff: MakeupStaffSnapshot[];
  eligible_student_count: number;
  billing_impact: "NONE";
  created_at: string;
  updated_at: string;
};

export type ClassScheduleAdjustmentResponse = {
  id: string;
  class_id: string;
  reason_code: MakeupReasonCode;
  reason_note: string | null;
  affected_from: string;
  affected_through: string;
  status: "OPEN" | "CLOSED";
  created_by: string;
  request_id: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ClassAdjustmentListResponse = {
  adjustments: ClassScheduleAdjustmentResponse[];
  exceptions: ClassSessionExceptionResponse[];
};

export type PostponementPreviewOption = {
  key: string;
  original_start_at: string;
  original_end_at: string;
  source_slot_key: string;
  teacher_ids: string[];
  assistant_ids: string[];
  adjustable: boolean;
  already_adjusted: boolean;
  passed: boolean;
};

export type PostponementPreviewResponse = {
  class_id: string;
  occurrences: PostponementPreviewOption[];
  billing_impact: "NONE";
};

export type MakeupConflictDetail = {
  code: MakeupErrorCode;
  message: string;
  class_id: string | null;
  class_name: string | null;
  staff_ids: string[];
  day: string | null;
  start: string | null;
  end: string | null;
};

export type MakeupSchedulePreviewResponse = {
  exception_id: string;
  original_start_at: string;
  original_end_at: string;
  duration_minutes: number;
  replacement_start_at: string;
  replacement_end_at: string;
  staff: MakeupStaffSnapshot[];
  eligible_student_count: number;
  conflicts: MakeupConflictDetail[];
  staff_inactive: MakeupStaffSnapshot[];
  can_schedule: boolean;
  billing_impact: "NONE";
};

export type PostponementCreateRequest = {
  original_start_at: string[];
  reason_code: MakeupReasonCode;
  reason_note?: string | null;
  schedule_now: boolean;
  request_id: string;
  retrospective?: boolean;
};

export type PostponementCreateResponse = {
  adjustment: ClassScheduleAdjustmentResponse;
  exceptions: ClassSessionExceptionResponse[];
  billing_impact: "NONE";
};

export type MakeupScheduleRequest = {
  replacement_start_at: string;
  request_id: string;
  expected_version: number;
};

export type MakeupCommandRequest = {
  request_id: string;
  expected_version: number;
};

export type ExceptionCommandResponse = {
  exception: ClassSessionExceptionResponse;
  effective_status: ClassEffectiveStatus;
  billing_impact: "NONE";
};

export type ClassHistoryTeacherEvent = {
  teacher_id: string;
  teacher_name: string;
  staff_type: "TEACHER" | "ASSISTANT";
  event_type: "assigned" | "unassigned";
  occurred_at: string;
};

export type ClassHistoryEnrollment = {
  enrollment_id: string;
  student_id: string;
  student_name: string;
  enrollment_date: string | null;
  ended_at: string | null;
  status: "active" | "dropped" | "completed" | "cancelled";
};

export type ClassHistoryEvent = {
  event_type: string;
  previous_end_date: string | null;
  next_end_date: string | null;
  reason: string | null;
  occurred_at: string;
};

export type ClassHistoryAdjustment = {
  adjustment_id: string;
  reason_code: MakeupReasonCode;
  reason_note: string | null;
  original_start_at: string;
  original_end_at: string;
  status: ExceptionStatus;
  display_status: ExceptionDisplayStatus;
  replacement_start_at: string | null;
  replacement_end_at: string | null;
  completed_at: string | null;
  restored_at: string | null;
  version: number;
};

export type ClassHistory = {
  id: string;
  name: string;
  display_name: string;
  primary_label: string;
  secondary_label: string | null;
  effective_status: ClassEffectiveStatus;
  start_date: string | null;
  end_date: string | null;
  schedule: ClassSchedule;
  teachers: ClassHistoryTeacherEvent[];
  enrollments: ClassHistoryEnrollment[];
  lifecycle_events: ClassHistoryEvent[];
  adjustments: ClassHistoryAdjustment[];
};

export type ClassScopeSummary = {
  operational: number;
  active: number;
  scheduled: number;
  completed: number;
  cancelled: number;
};

export type ClassCreate = {
  name: string;
  type: ClassType;
  base_fee: number;
  billing_cycle_months: number;
  billing_cycle_weeks?: number | null;
  start_date: string;
  end_date: string;
  identity_scheme: Exclude<ClassIdentityScheme, "LEGACY">;
  class_category: ClassCategory;
  grade_mode: ClassGradeMode;
  program_name?: string | null;
  grade_level?: number | null;
  academic_year_start?: number | null;
  schedule?: ClassSchedule;
  teacher_id?: string | null;
  teacher_ids?: string[];
  assistant_ids?: string[];
};

export type ClassUpdate = Partial<Omit<ClassCreate, "identity_scheme">> & {
  identity_scheme?: ClassIdentityScheme;
  end_date_change_reason?: string;
  expected_version?: number;
  expected_fingerprint?: string;
  is_active?: boolean;
};

export type ClassEndDateUpdate = {
  end_date: string;
  reason: string;
  expected_version: number;
  expected_fingerprint: string;
};

export type ClassEndDatePreview = {
  previous_end_date: string;
  next_end_date: string;
  total_weeks: number | null;
  package_count: number | null;
  affected_student_count: number;
  mutable_fee_record_count: number;
  protected_fee_record_count: number;
  version: number;
  preview_fingerprint: string;
  preview_expires_at: string;
};

export type StudentStatus = "active" | "inactive" | "archived";
export type StudentListState = "UNASSIGNED" | "CURRENT" | "FORMER" | "ARCHIVED";
export type StudentHiddenField =
  | "birth_date"
  | "school"
  | "enrollment_date"
  | "custom_fee"
  | "student_contact"
  | "parent_contact"
  | "notes";
type FeeStatus = "PAID" | "UNPAID";

type StudentClassInfo = {
  id: string;
  name: string;
};

export type StudentEnrollmentInfo = {
  id: string;
  class_id: string;
  class_name: string;
  class_category: ClassCategory | null;
  class_grade_mode: ClassGradeMode | null;
  class_grade_level: number | null;
  class_start_date: string | null;
  class_end_date: string | null;
  custom_fee: number | null;
  effective_fee: number;
  enrollment_date: string | null;
  status: "active" | "dropped" | "completed" | "cancelled";
};

export type StudentResponse = {
  id: string;
  student_code?: string | null;
  full_name: string;
  birth_date: string | null;
  school: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_zalo: string | null;
  student_zalo: string | null;
  student_phone: string | null;
  notes: string | null;
  hidden_fields: StudentHiddenField[];
  status: StudentStatus;
  list_state?: StudentListState;
  archived_at?: string | null;
  archived_reason?: string | null;
  classes: StudentClassInfo[];
  active_enrollments: StudentEnrollmentInfo[];
  created_at: string;
};

export type StudentCreate = {
  full_name: string;
  class_id?: string | null;
  custom_fee?: number | null;
  enrollment_date?: string | null;
  birth_date: string;
  school: string;
  parent_name?: string | null;
  parent_phone: string;
  parent_zalo: string;
  student_zalo?: string | null;
  student_phone?: string | null;
  notes?: string | null;
  hidden_fields?: StudentHiddenField[];
  duplicate_resolution?: StudentDuplicateResolution;
};

export type StudentDuplicateResolution = {
  action: "create_new";
  candidate_ids: string[];
};

export type StudentIdentityCandidate = {
  id: string;
  status: StudentStatus;
  full_name: string;
  birth_date: string | null;
  school: string | null;
  masked_parent_phone: string | null;
  masked_student_phone: string | null;
  previous_classes: {
    name: string;
    enrollment_date: string | null;
  }[];
  updated_at: string;
  match_strength: "strong" | "possible";
  match_reason: string;
  already_in_target_class: boolean;
};

export type StudentIdentityConflict = {
  code: "STUDENT_IDENTITY_CONFLICT" | "STUDENT_IDENTITY_CONFLICT_CHANGED";
  message: string;
  target_class_id?: string | null;
  candidates: StudentIdentityCandidate[];
};

export type StudentReactivationRequest = {
  student: Omit<StudentCreate, "duplicate_resolution">;
  expected_updated_at: string;
};

export type StudentUpdate = {
  full_name?: string;
  birth_date?: string | null;
  school?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  parent_zalo?: string | null;
  student_zalo?: string | null;
  student_phone?: string | null;
  notes?: string | null;
  hidden_fields?: StudentHiddenField[];
  status?: StudentStatus;
};

export type ContactSuggestionResponse = {
  phone: string;
  zalo_name: string;
};

export type EnrollmentResponse = {
  id: string;
  student_id: string;
  class_id: string;
  custom_fee: number | null;
  status: "active" | "dropped" | "completed" | "cancelled";
  enrollment_date: string | null;
  class_name: string;
  class_category: ClassCategory | null;
  class_grade_mode: ClassGradeMode | null;
  class_grade_level: number | null;
  class_start_date: string | null;
  class_end_date: string | null;
  effective_fee: number;
};

export type EnrollmentUpdate = {
  custom_fee?: number | null;
  enrollment_date?: string | null;
};

export type EnrollmentCreate = {
  student_id: string;
  class_id: string;
  custom_fee?: number | null;
  enrollment_date?: string | null;
};

type DashboardOperationsSummary = {
  period: string;
  active_student_count: number;
  active_class_count: number;
  weekly_session_count: number;
  active_teacher_count: number;
  active_assistant_count: number;
};

export type DashboardFeeSummary = {
  total_amount: number;
  gross_collected_amount: number;
  refunded_amount: number;
  net_collected_amount: number;
  outstanding_amount: number;
  paid_record_count: number;
  record_count: number;
};

export type DashboardRevenuePoint = {
  period: string;
  net_collected_amount: number;
};

export type DashboardOverviewResponse = {
  summary: DashboardOperationsSummary;
  fees: DashboardFeeSummary;
  revenue_trend: DashboardRevenuePoint[];
};

export type FeeNotificationState = "UNNOTIFIED" | "NOTIFIED_UNPAID" | "PAID";
export type FeePaymentMethod = "bank_transfer" | "cash";
export type FeeRefundState = "NONE" | "PARTIAL" | "FULL";
export type FeePaymentEntryType =
  | "payment"
  | "payment_reversal"
  | "refund"
  | "refund_reversal";

export type FeeRecordResponse = {
  id: string;
  enrollment_id: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_name: string;
  class_type: "MONTHLY" | "COURSE";
  billing_cycle_months: number;
  billing_cycle_weeks?: number | null;
  student_phone: string | null;
  student_zalo: string | null;
  student_contact_hidden: boolean;
  parent_phone: string | null;
  parent_zalo: string | null;
  parent_contact_hidden: boolean;
  period: string;
  enrollment_date: string | null;
  due_date: string | null;
  base_amount: number;
  discount_amount: number;
  final_amount: number;
  status: FeeStatus;
  paid_amount: number | null;
  paid_date: string | null;
  refunded_amount: number;
  refundable_amount: number;
  net_collected_amount: number;
  refund_state: FeeRefundState;
  notified_at: string | null;
  notification_channel: string | null;
  notification_message: string | null;
  notification_state: FeeNotificationState;
};

export type FeeRecordListResponse = {
  period: string;
  records: FeeRecordResponse[];
};

export type FeePeriodListResponse = {
  periods: string[];
};

export type FeeMessageTemplatesResponse = {
  payment_reminder_template: string;
  payment_received_template: string;
  version: number;
  updated_at: string | null;
};

export type FeeMessageTemplatesUpdate = Omit<FeeMessageTemplatesResponse, "updated_at">;

export type FeeBatchActionResponse = {
  records: FeeRecordResponse[];
  deleted_ids: string[];
};

export type FeeUnpayTargetState = "UNNOTIFIED" | "NOTIFIED_UNPAID";

export type FeeRefundRequest = {
  request_id: string;
  items: Array<{ record_id: string; amount: number }>;
  reason: string;
  refund_method: FeePaymentMethod;
};

export type FeeRefundReceipt = {
  request_id: string;
  refund_date: string;
  refund_method: FeePaymentMethod;
  reason: string;
  total_amount: number;
  items: Array<{
    transaction_id: string;
    record_id: string;
    amount: number;
    created_at: string;
  }>;
};

export type FeeRefundBatchResponse = FeeBatchActionResponse & {
  receipt: FeeRefundReceipt;
};

export type FeeRefundReversalRequest = {
  refund_transaction_id: string;
  reason: string;
  request_id: string;
};

export type FeeTransactionResponse = {
  id: string;
  entry_type: FeePaymentEntryType;
  amount: number;
  transaction_date: string;
  payment_method: FeePaymentMethod;
  note: string | null;
  related_payment_id: string | null;
  request_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type FeeTransactionListResponse = {
  fee_record_id: string;
  transactions: FeeTransactionResponse[];
};

export type FeeTransactionBatchResponse = {
  histories: FeeTransactionListResponse[];
};

export type FeeRefundReversalResponse = FeeBatchActionResponse & {
  transaction: FeeTransactionResponse;
};

export type FeeOperationAction =
  | "notify"
  | "unnotify"
  | "payment"
  | "payment_reversal"
  | "refund"
  | "refund_reversal"
  | "sync"
  | "template_update";

export type FeeOperationItem = {
  id: string;
  ordinal: number;
  fee_record_id: string | null;
  enrollment_id: string | null;
  student_id: string | null;
  student_name: string | null;
  class_id: string | null;
  class_name: string | null;
  period: string | null;
  state_before: string | null;
  state_after: string | null;
  amount_before: number | null;
  amount_after: number | null;
  amount_delta: number;
  due_date_before: string | null;
  due_date_after: string | null;
  payment_method: FeePaymentMethod | null;
  notification_channel: string | null;
  message: string | null;
  reason: string | null;
  payment_id: string | null;
  related_payment_id: string | null;
};

export type FeeOperation = {
  id: string;
  sequence_no: number;
  action: FeeOperationAction;
  origin: "application" | "migration" | "system";
  request_id: string | null;
  period: string | null;
  business_date: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_username: string | null;
  actor_role: string | null;
  item_count: number;
  total_amount: number;
  items: FeeOperationItem[];
};

export type FeeOperationListResponse = {
  operations: FeeOperation[];
  next_cursor: string | null;
  summary: {
    operation_count: number;
    affected_item_count: number;
    financial_net_change: number;
  };
  history_complete_from: string | null;
};

export type FeePaidReceiptRefundState =
  | "NONE"
  | "PARTIAL"
  | "FULL"
  | "REVERSED";

export type FeePaidReceiptTimelineEvent =
  | "payment"
  | "refund"
  | "refund_reversal"
  | "payment_reversal";

export type FeePaidReceiptSummary = {
  receipt_id: string;
  payment_operation_id: string;
  student_id: string | null;
  student_name: string;
  period: string | null;
  paid_date: string;
  paid_at: string;
  payment_method: FeePaymentMethod;
  gross_amount: number;
  refunded_amount: number;
  net_amount: number;
  refund_state: FeePaidReceiptRefundState;
  class_count: number;
  class_names: string[];
  actor_name: string | null;
  actor_username: string | null;
  actor_role: string | null;
};

export type FeePaidReportSummary = {
  gross_amount: number;
  refunded_amount: number;
  net_amount: number;
  receipt_count: number;
  student_count: number;
  bank_transfer_net_amount: number;
  cash_net_amount: number;
};

export type FeePaidReceiptAllocation = {
  fee_record_id: string | null;
  enrollment_id: string | null;
  class_id: string | null;
  class_name: string;
  period: string;
  gross_amount: number;
  refunded_amount: number;
  net_amount: number;
};

export type FeePaidReceiptTimelineItem = {
  id: string;
  event: FeePaidReceiptTimelineEvent;
  business_date: string;
  occurred_at: string;
  amount_delta: number;
  payment_method: FeePaymentMethod;
  actor_name: string | null;
  actor_username: string | null;
  actor_role: string | null;
  reason: string | null;
};

export type FeePaidReceiptDetail = FeePaidReceiptSummary & {
  allocations: FeePaidReceiptAllocation[];
  timeline: FeePaidReceiptTimelineItem[];
};

export type FeePaidReceiptListResponse = {
  receipts: FeePaidReceiptSummary[];
  next_cursor: string | null;
  summary: FeePaidReportSummary;
};

export type StaffType = "TEACHER" | "ASSISTANT";

export type StaffAssignedClass = {
  id: string;
  name: string;
  is_active: boolean;
};

export type StaffResponse = {
  id: string;
  full_name: string;
  staff_type: StaffType;
  zalo_name: string | null;
  phone: string | null;
  is_active: boolean;
  assigned_classes: StaffAssignedClass[];
  created_at: string;
  updated_at: string;
};

export type TeacherOptionResponse = {
  id: string;
  full_name: string;
  staff_type: StaffType;
};

export type StaffCreate = {
  full_name: string;
  staff_type: StaffType;
  zalo_name?: string | null;
  phone?: string | null;
  is_active?: boolean;
};

export type StaffUpdate = Partial<StaffCreate>;
