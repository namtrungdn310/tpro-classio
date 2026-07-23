export type ClassType = "MONTHLY" | "COURSE";

export type ClassScheduleSlot = {
  day: "Thứ 2" | "Thứ 3" | "Thứ 4" | "Thứ 5" | "Thứ 6" | "Thứ 7" | "Chủ Nhật";
  start: string;
  end: string;
};

export type ClassSchedule = {
  text?: string;
  slots?: ClassScheduleSlot[];
} | null;

export type ClassResponse = {
  id: string;
  name: string;
  type: ClassType;
  base_fee: number;
  billing_cycle_months: number;
  start_date: string | null;
  end_date: string | null;
  schedule: ClassSchedule;
  teacher_id: string | null;
  teacher_ids: string[];
  teacher_name: string | null;
  teacher_names: string[];
  is_active: boolean;
  student_count: number;
  created_at: string;
};

export type ClassCreate = {
  name: string;
  type: ClassType;
  base_fee: number;
  billing_cycle_months: number;
  schedule?: ClassSchedule;
  teacher_id?: string | null;
  teacher_ids?: string[];
};

export type ClassUpdate = Partial<ClassCreate> & {
  is_active?: boolean;
};

export type StudentStatus = "active" | "inactive";
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
  custom_fee: number | null;
  enrollment_date: string | null;
  status: "active" | "dropped";
};

export type StudentResponse = {
  id: string;
  full_name: string;
  birth_date: string | null;
  school: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_zalo: string | null;
  parent_contact_hidden: boolean;
  student_zalo: string | null;
  student_phone: string | null;
  notes: string | null;
  hidden_fields: StudentHiddenField[];
  status: StudentStatus;
  classes: StudentClassInfo[];
  active_enrollments: StudentEnrollmentInfo[];
  created_at: string;
};

export type StudentCreate = {
  full_name: string;
  class_id: string;
  custom_fee?: number | null;
  enrollment_date: string;
  birth_date: string;
  school: string;
  parent_name?: string | null;
  parent_phone: string;
  parent_zalo: string;
  student_zalo?: string | null;
  student_phone?: string | null;
  notes?: string | null;
  hidden_fields?: StudentHiddenField[];
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
  status: "active" | "dropped";
  enrollment_date: string | null;
  class_name: string;
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
};

export type StaffCreate = {
  full_name: string;
  staff_type: StaffType;
  zalo_name?: string | null;
  phone?: string | null;
  is_active?: boolean;
};

export type StaffUpdate = Partial<StaffCreate>;
