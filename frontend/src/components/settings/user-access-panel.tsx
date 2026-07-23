"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, LoaderCircle, Mail, RefreshCw, RotateCcw, UsersRound } from "lucide-react";
import { z } from "zod";
import { useToast } from "@/components/providers/toast-provider";
import { SettingsCard } from "@/components/settings/settings-card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { DataSectionEmpty, DataSectionError } from "@/components/ui/data-section-state";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import {
  createInvitation,
  getUsers,
  updateUserRole,
  updateUserStatus,
  type AccountStatus,
  type InvitationResponse,
  type UserAccount,
} from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
} from "@/lib/auth/field-feedback";
import { authQueryKeys } from "@/lib/auth/query-keys";
import { useAuth } from "@/lib/hooks/useAuth";
import { noSavedInfoFormProps } from "@/lib/forms/saved-info-policy";
import { validationMessages } from "@/lib/forms/validation-messages";
import { useModalDialog } from "@/lib/hooks/useModalDialog";
import { cn } from "@/lib/utils";

type UserRole = "admin" | "viewer";
type PendingAction = "role" | "status";
type ConfirmationTarget =
  | { account: UserAccount; kind: "role"; nextRole: UserRole }
  | { account: UserAccount; kind: "disable" | "reactivate" };

const USER_GRID = "grid-cols-[minmax(210px,1.5fr)_150px_148px_126px]";
const STATUS_ORDER: Record<AccountStatus, number> = { pending: 0, active: 1, disabled: 2 };
const inviteEmailSchema = z
  .string()
  .trim()
  .min(1, validationMessages.required("email"))
  .max(254, "Email không được vượt quá 254 ký tự.")
  .email(validationMessages.emailFormat);

export function UserAccessPanel() {
  const queryClient = useQueryClient();
  const notify = useToast();
  const { user } = useAuth();
  const isOwner = user?.is_owner ?? false;
  const pendingIdsRef = useRef(new Set<string>());
  const [pendingById, setPendingById] = useState<Record<string, PendingAction | undefined>>({});
  const [confirmationTarget, setConfirmationTarget] = useState<ConfirmationTarget | null>(null);
  // Invite dialog state
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState<InvitationResponse | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteServerError, setInviteServerError] = useState("");
  const [inviteSubmitAttempted, setInviteSubmitAttempted] = useState(false);
  const [inviteEmailFeedback, setInviteEmailFeedback] = useState(initialFieldFeedback);
  const usersQuery = useQuery({
    queryKey: authQueryKeys.users,
    queryFn: getUsers,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const sortedUsers = useMemo(() => sortAccounts(users), [users]);
  const counts = useMemo(
    () => ({
      active: users.filter((account) => getAccountStatus(account) === "active").length,
      pending: users.filter((account) => getAccountStatus(account) === "pending").length,
      disabled: users.filter((account) => getAccountStatus(account) === "disabled").length,
    }),
    [users],
  );
  const hasData = usersQuery.data !== undefined;
  const hasBlockingError = usersQuery.isError && !hasData;
  const hasCachedError = usersQuery.isError && hasData;
  const isInitialLoading = usersQuery.isPending && !hasData;
  const confirmationPending = confirmationTarget
    ? Boolean(pendingById[confirmationTarget.account.id])
    : false;
  const inviteEmailResult = inviteEmailSchema.safeParse(inviteEmail);
  const inviteValidationError = inviteEmailResult.success
    ? ""
    : inviteEmailResult.error.issues[0]?.message ?? validationMessages.emailFormat;
  const inviteError =
    inviteServerError ||
    (shouldShowFieldError(inviteEmailFeedback, inviteSubmitAttempted)
      ? inviteValidationError
      : "");

  function setPending(userId: string, action?: PendingAction) {
    if (action) pendingIdsRef.current.add(userId);
    else pendingIdsRef.current.delete(userId);
    setPendingById((current) => {
      if (action) return { ...current, [userId]: action };
      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  function updateCachedUser(updated: UserAccount) {
    queryClient.setQueryData<UserAccount[]>(authQueryKeys.users, (current = []) =>
      current.map((account) => (account.id === updated.id ? updated : account)),
    );
  }

  async function applyRole(account: UserAccount, role: UserRole) {
    if (pendingIdsRef.current.has(account.id) || getAccountStatus(account) !== "active") {
      return false;
    }
    setPending(account.id, "role");
    try {
      const updated = await updateUserRole(account.id, role);
      updateCachedUser(updated);
      notify.success(
        role === "admin"
          ? `Đã cấp quyền Admin cho ${getAccountName(account)}.`
          : `Đã chuyển ${getAccountName(account)} về quyền Viewer.`,
      );
      void queryClient.invalidateQueries({ queryKey: authQueryKeys.users });
      return true;
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể thay đổi quyền người dùng."), {
        duration: 0,
      });
      return false;
    } finally {
      setPending(account.id);
    }
  }

  async function applyStatus(account: UserAccount, status: "active" | "disabled") {
    if (pendingIdsRef.current.has(account.id)) return false;
    setPending(account.id, "status");
    try {
      const updated = await updateUserStatus(account.id, status);
      updateCachedUser(updated);
      notify.success(
        status === "disabled"
          ? `Đã vô hiệu hoá ${getAccountName(account)}.`
          : `Đã kích hoạt lại ${getAccountName(account)}.`,
      );
      void queryClient.invalidateQueries({ queryKey: authQueryKeys.users });
      return true;
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể thay đổi trạng thái tài khoản."), {
        duration: 0,
      });
      return false;
    } finally {
      setPending(account.id);
    }
  }

  async function confirmAction() {
    if (!confirmationTarget) return;
    const succeeded = confirmationTarget.kind === "role"
      ? await applyRole(confirmationTarget.account, confirmationTarget.nextRole)
      : await applyStatus(
          confirmationTarget.account,
          confirmationTarget.kind === "disable" ? "disabled" : "active",
        );
    if (succeeded) setConfirmationTarget(null);
  }

  async function handleInvite() {
    setInviteSubmitAttempted(true);
    setInviteEmailFeedback((current) => fieldFeedbackAfterSubmit(current));
    const parsedEmail = inviteEmailSchema.safeParse(inviteEmail);
    if (!parsedEmail.success) {
      return;
    }
    const email = parsedEmail.data.toLowerCase();
    setIsInviting(true);
    setInviteServerError("");
    try {
      const result = await createInvitation(email);
      setInviteResult(result);
    } catch (err) {
      setInviteServerError(
        getApiErrorMessage(err, "Không tạo được lời mời. Vui lòng thử lại."),
      );
    } finally {
      setIsInviting(false);
    }
  }

  function handleCloseInviteDialog() {
    setShowInviteDialog(false);
    setInviteEmail("");
    setInviteResult(null);
    setInviteServerError("");
    setInviteSubmitAttempted(false);
    setInviteEmailFeedback(initialFieldFeedback);
  }

  async function handleCopyInvitation(inviteUrl: string) {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(inviteUrl);
      notify.success("Đã sao chép đường dẫn mời.");
    } catch {
      notify.error("Không thể sao chép. Vui lòng sao chép thủ công.");
    }
  }

  return (
    <SettingsCard title="Quyền truy cập" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-gray-600">
          <AccountCount dotClass="bg-emerald-500" label={`${counts.active} hoạt động`} />
          <AccountCount dotClass="bg-amber-500" label={`${counts.pending} chưa hoàn tất`} />
          <AccountCount dotClass="bg-gray-400" label={`${counts.disabled} vô hiệu`} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={usersQuery.isFetching}
            onClick={() => void usersQuery.refetch()}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-200 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3 w-3 motion-reduce:animate-none ${usersQuery.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Làm mới
          </button>
          {isOwner ? (
            <button
              type="button"
              onClick={() => { setShowInviteDialog(true); }}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-200"
            >
              <Mail className="h-3 w-3" aria-hidden="true" />
              Mời thành viên
            </button>
          ) : null}
        </div>
      </div>

      {hasCachedError ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          <span>Chưa cập nhật được dữ liệu mới nhất; danh sách gần nhất vẫn đang hiển thị.</span>
          <button
            type="button"
            disabled={usersQuery.isFetching}
            onClick={() => void usersQuery.refetch()}
            className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-50"
          >
            {usersQuery.isFetching ? <LoadingLabel label="Đang thử lại" /> : "Thử lại"}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {isInitialLoading ? <UserAccessSkeleton /> : null}
        {hasBlockingError ? (
          <DataSectionError
            className="h-full min-h-56 rounded-none border-0"
            title="Không tải được danh sách người dùng"
            description={getApiErrorMessage(
              usersQuery.error,
              "Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại.",
            )}
            isRetrying={usersQuery.isFetching}
            onRetry={() => void usersQuery.refetch()}
          />
        ) : null}
        {!isInitialLoading && !hasBlockingError && users.length === 0 ? (
          <DataSectionEmpty
            className="h-full min-h-56 rounded-none border-0"
            icon={UsersRound}
            title="Chưa có người dùng"
            description="Tài khoản mới sẽ xuất hiện tại đây sau khi xác thực email."
          />
        ) : null}
        {!isInitialLoading && !hasBlockingError && users.length > 0 ? (
          <UserAccessList
            users={sortedUsers}
            pendingById={pendingById}
            onRoleChange={(account, nextRole) =>
              setConfirmationTarget({ account, kind: "role", nextRole })
            }
            onStatusChange={(account) => {
              const status = getAccountStatus(account);
              if (status === "pending") return;
              setConfirmationTarget({
                account,
                kind: status === "active" ? "disable" : "reactivate",
              });
            }}
          />
        ) : null}
      </div>

      <ConfirmationDialog
        open={confirmationTarget !== null}
        title={getConfirmationTitle(confirmationTarget)}
        description={getConfirmationDescription(confirmationTarget)}
        confirmLabel={getConfirmationLabel(confirmationTarget)}
        tone={confirmationTarget?.kind === "disable" ? "danger" : "default"}
        isPending={confirmationPending}
        onCancel={() => setConfirmationTarget(null)}
        onConfirm={() => void confirmAction()}
      />

      {/* Invite member dialog — owner only */}
      {showInviteDialog ? (
        <InviteDialogShell isBusy={isInviting} onClose={handleCloseInviteDialog}>
            <h2 className="page-title-text mb-1 text-gray-950">Mời thành viên</h2>
            <p className="form-message-text mb-4 text-gray-500">
              Nhập email để tạo đường dẫn mời dùng một lần.
            </p>

            {!inviteResult ? (
              <form
                {...noSavedInfoFormProps}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleInvite();
                }}
              >
                <label htmlFor="invite-email" className="form-label-text mb-1.5 block text-gray-700">
                  Email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setInviteEmail(value);
                    setInviteServerError("");
                    setInviteEmailFeedback((current) =>
                      fieldFeedbackAfterInput(current, value),
                    );
                  }}
                  onBlur={() => setInviteEmailFeedback(fieldFeedbackAfterBlur)}
                  placeholder="nguoi-dung@example.com"
                  autoComplete="off"
                  disabled={isInviting}
                  aria-invalid={Boolean(inviteError)}
                  aria-describedby={inviteError ? "invite-email-error" : undefined}
                  className={cn(
                    formTextControlClassName,
                    inviteError && formTextControlErrorClassName,
                    !inviteError && "mb-3",
                  )}
                />
                {inviteError ? (
                  <p id="invite-email-error" role="alert" className="form-message-text mb-3 mt-1 text-red-600">
                    {inviteError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isInviting}
                    onClick={handleCloseInviteDialog}
                    className="h-8 rounded-md px-3 text-sm"
                  >
                    Huỷ
                  </Button>
                  <Button
                    type="submit"
                    disabled={isInviting}
                    className="h-8 rounded-md bg-gray-950 px-3 text-sm text-white hover:bg-black"
                  >
                    <LoadingLabel
                      label="Đang tạo"
                      isLoading={isInviting}
                      idleLabel="Tạo lời mời"
                    />
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p className="form-message-text mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                  Đã tạo lời mời cho <strong>{inviteResult.email}</strong>.
                </p>
                <label htmlFor="invite-url" className="form-label-text mb-1 block text-gray-600">
                  Đường dẫn mời
                </label>
                <div className="mb-4 flex gap-2">
                  <input
                    id="invite-url"
                    type="text"
                   readOnly
                   autoComplete="off"
                   value={inviteResult.invite_url}
                    className={cn(
                      formTextControlClassName,
                      "min-w-0 flex-1 bg-gray-50 text-xs text-gray-700",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyInvitation(inviteResult.invite_url)}
                    className="rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Sao chép
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleCloseInviteDialog}
                  className="w-full rounded-lg bg-gray-900 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
                >
                  Đóng
                </button>
              </>
            )}
        </InviteDialogShell>
      ) : null}
    </SettingsCard>
  );
}

function InviteDialogShell({
  children,
  isBusy,
  onClose,
}: {
  children: ReactNode;
  isBusy: boolean;
  onClose: () => void;
}) {
  const { backdropPointerDownRef, dialogRef, requestClose } = useModalDialog({
    isBusy,
    onClose,
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) {
          requestClose();
        }
        backdropPointerDownRef.current = false;
      }}
      onPointerCancel={() => {
        backdropPointerDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Mời thành viên"
        aria-busy={isBusy || undefined}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}


function AccountCount({ dotClass, label }: { dotClass: string; label: string }) {
  return (
    <span className="inline-flex select-none items-center gap-1.5 whitespace-nowrap">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function UserAccessList({
  onRoleChange,
  onStatusChange,
  pendingById,
  users,
}: {
  onRoleChange: (account: UserAccount, role: UserRole) => void;
  onStatusChange: (account: UserAccount) => void;
  pendingById: Record<string, PendingAction | undefined>;
  users: UserAccount[];
}) {
  return (
    <div className="scrollbar-hidden h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain">
      <div className="grid gap-3 p-3 lg:hidden">
        {users.map((account) => (
          <UserAccessCard
            key={account.id}
            account={account}
            pendingAction={pendingById[account.id]}
            onRoleChange={onRoleChange}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>

      <div role="table" aria-label="Danh sách quyền truy cập" className="hidden h-full min-h-0 lg:flex lg:flex-col">
        <div role="rowgroup" className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div role="row" className={`grid ${USER_GRID} table-heading-text items-center text-gray-700`}>
            <ColumnHeader>Tài khoản</ColumnHeader>
            <ColumnHeader>Vai trò</ColumnHeader>
            <ColumnHeader>Trạng thái</ColumnHeader>
            <ColumnHeader align="center">Thao tác</ColumnHeader>
          </div>
        </div>
        <div role="rowgroup" className="scrollbar-hidden min-h-0 flex-1 divide-y divide-gray-100 overflow-x-hidden overflow-y-auto overscroll-contain">
          {users.map((account) => (
            <UserAccessRow
              key={account.id}
              account={account}
              pendingAction={pendingById[account.id]}
              onRoleChange={onRoleChange}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function UserAccessRow(props: UserAccessItemProps) {
  return (
    <div role="row" className={`grid ${USER_GRID} items-center transition-colors hover:bg-gray-50/80`}>
      <DataCell><AccountIdentity account={props.account} /></DataCell>
      <DataCell><AccountRoleControl {...props} /></DataCell>
      <DataCell><AccountStatusLabel status={getAccountStatus(props.account)} /></DataCell>
      <DataCell><AccountStatusAction {...props} /></DataCell>
    </div>
  );
}

function UserAccessCard(props: UserAccessItemProps) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <AccountIdentity account={props.account} />
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="table-heading-text select-none text-gray-500">Vai trò</dt>
          <dd className="mt-1"><AccountRoleControl {...props} /></dd>
        </div>
        <div>
          <dt className="table-heading-text select-none text-gray-500">Trạng thái</dt>
          <dd className="mt-1"><AccountStatusLabel status={getAccountStatus(props.account)} /></dd>
        </div>
      </dl>
      <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
        <AccountStatusAction {...props} />
      </div>
    </article>
  );
}

type UserAccessItemProps = {
  account: UserAccount;
  onRoleChange: (account: UserAccount, role: UserRole) => void;
  onStatusChange: (account: UserAccount) => void;
  pendingAction?: PendingAction;
};

function AccountRoleControl({ account, onRoleChange, pendingAction }: UserAccessItemProps) {
  const status = getAccountStatus(account);
  if (account.is_owner || status !== "active") return <RoleLabel account={account} />;

  return (
    <div
      role="group"
      aria-label={`Vai trò của ${getAccountName(account)}`}
      className="grid h-8 w-[138px] shrink-0 grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-gray-100 p-0.5"
    >
      {(["viewer", "admin"] as const).map((role) => {
        const selected = normalizeRole(account) === role;
        return (
          <button
            key={role}
            type="button"
            aria-pressed={selected}
            aria-label={`Đặt ${getAccountName(account)} thành ${role === "admin" ? "Admin" : "Viewer"}`}
            disabled={Boolean(pendingAction) || selected}
            onClick={() => onRoleChange(account, role)}
            className={`rounded-[5px] text-xs font-medium transition ${
              selected
                ? "bg-white text-gray-950 shadow-sm"
                : "text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            } disabled:cursor-default`}
          >
            {role === "admin" ? "Admin" : "Viewer"}
          </button>
        );
      })}
    </div>
  );
}

function AccountStatusAction({ account, onStatusChange, pendingAction }: UserAccessItemProps) {
  if (account.is_owner) {
    return <span className="select-none text-[13px] font-medium text-gray-400">Cố định</span>;
  }
  const status = getAccountStatus(account);
  if (status === "pending") {
    return <span className="select-none text-[13px] font-medium text-gray-400">Chưa hoàn tất</span>;
  }
  return (
    <button
      type="button"
      disabled={Boolean(pendingAction)}
      onClick={() => onStatusChange(account)}
      className={`inline-flex h-8 min-w-[102px] items-center justify-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60 ${
        status === "active"
          ? "border-gray-200 text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-100"
          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-100"
      }`}
    >
      {pendingAction === "status" ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : status === "disabled" ? (
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {status === "disabled" ? "Kích hoạt" : "Vô hiệu hoá"}
    </button>
  );
}

function AccountIdentity({ account }: { account: UserAccount }) {
  const username = account.is_owner
    ? "Dev"
    : account.username || account.full_name || "Chưa đặt tên";
  return (
    <div className="min-w-0 leading-5">
      <p className="break-words text-[15px] font-semibold text-gray-950">{username}</p>
      <p className="mt-0.5 break-all text-[13px] font-normal leading-4 text-gray-500">{account.email}</p>
    </div>
  );
}

function RoleLabel({ account }: { account: UserAccount }) {
  return (
    <span className="inline-flex select-none rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
      {getRoleLabel(account)}
    </span>
  );
}

function AccountStatusLabel({ status }: { status: AccountStatus }) {
  const config = {
    active: { dot: "bg-emerald-500", text: "Đang hoạt động", textClass: "text-emerald-700" },
    disabled: { dot: "bg-gray-400", text: "Đã vô hiệu", textClass: "text-gray-600" },
    pending: { dot: "bg-amber-500", text: "Chưa hoàn tất", textClass: "text-amber-700" },
  }[status];
  return (
    <span className={`inline-flex select-none items-center gap-1.5 whitespace-nowrap text-[13px] font-medium ${config.textClass}`}>
      <span className={`h-2 w-2 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.text}
    </span>
  );
}

function getConfirmationTitle(target: ConfirmationTarget | null) {
  if (!target) return "Xác nhận thay đổi";
  if (target.kind === "role") return target.nextRole === "admin" ? "Cấp quyền Admin" : "Chuyển về Viewer";
  if (target.kind === "reactivate") return "Kích hoạt lại tài khoản";
  return "Vô hiệu hoá tài khoản";
}

function getConfirmationDescription(target: ConfirmationTarget | null) {
  if (!target) return null;
  const name = getAccountName(target.account);
  if (target.kind === "role") {
    return (
      <>
        Đổi quyền của <strong className="font-semibold text-gray-800">{name}</strong> từ {getRoleLabel(target.account)} sang {target.nextRole === "admin" ? "Admin" : "Viewer"}. Các phiên đăng nhập hiện tại sẽ bị thu hồi.
      </>
    );
  }
  if (target.kind === "reactivate") {
    return (
      <>
        Khôi phục quyền đăng nhập của <strong className="font-semibold text-gray-800">{name}</strong> theo vai trò {getRoleLabel(target.account)}.
      </>
    );
  }
  return (
    <>
      <strong className="font-semibold text-gray-800">{name}</strong> sẽ bị đăng xuất và không thể đăng nhập cho đến khi được kích hoạt lại.
    </>
  );
}

function getConfirmationLabel(target: ConfirmationTarget | null) {
  if (!target) return "Xác nhận";
  if (target.kind === "role") return "Đổi quyền";
  if (target.kind === "reactivate") return "Kích hoạt";
  return "Vô hiệu hoá";
}

function sortAccounts(accounts: UserAccount[]) {
  return [...accounts].sort((left, right) => {
    if (left.is_owner !== right.is_owner) return left.is_owner ? -1 : 1;
    const statusDifference = STATUS_ORDER[getAccountStatus(left)] - STATUS_ORDER[getAccountStatus(right)];
    if (statusDifference !== 0) return statusDifference;
    return getAccountName(left).localeCompare(getAccountName(right), "vi");
  });
}

function normalizeRole(account: UserAccount): UserRole {
  return account.role === "admin" ? "admin" : "viewer";
}

function getRoleLabel(account: UserAccount) {
  return account.is_owner ? "Dev" : normalizeRole(account) === "admin" ? "Admin" : "Viewer";
}

function getAccountStatus(account: UserAccount): AccountStatus {
  return account.account_status;
}

function getAccountName(account: UserAccount) {
  return account.is_owner ? "Dev" : account.username || account.full_name || account.email;
}

function ColumnHeader({
  align = "left",
  children,
}: {
  align?: "center" | "left";
  children: React.ReactNode;
}) {
  return (
    <div
      role="columnheader"
      className={cn(
        "select-none whitespace-nowrap px-3 py-3",
        align === "center" ? "text-center" : "text-left",
      )}
    >
      {children}
    </div>
  );
}

function DataCell({ children }: { children: React.ReactNode }) {
  return <div role="cell" className="min-w-0 px-3 py-3 text-[15px] font-medium leading-5">{children}</div>;
}

function UserAccessSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Đang tải danh sách người dùng"
      className="animate-pulse divide-y divide-gray-100 motion-reduce:animate-none"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className={`hidden ${USER_GRID} lg:grid`}>
          <div className="px-3 py-3"><div className="h-9 w-44 max-w-full rounded bg-gray-200" /></div>
          <div className="px-3 py-3"><div className="h-8 w-32 rounded bg-gray-200" /></div>
          <div className="px-3 py-3"><div className="h-4 w-24 rounded bg-gray-200" /></div>
          <div className="px-3 py-3"><div className="h-8 w-24 max-w-full rounded bg-gray-200" /></div>
        </div>
      ))}
      <div className="grid gap-3 p-3 lg:hidden">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-36 rounded-lg border border-gray-200 bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
