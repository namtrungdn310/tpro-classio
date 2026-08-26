"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import {
  FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RiBankCardLine,
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightLine,
  RiBookOpenLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiLinkM,
  RiLockLine,
  RiRefreshLine,
  RiSearchLine,
  RiWebhookLine,
  RiExternalLinkLine,
  RiInformationLine,
  RiImageAddLine,
  RiCloseLine,
} from "react-icons/ri";

import {
  archiveBankAccount,
  confirmPay2SBankOtp,
  connectPay2SBank,
  createManualBankAccount,
  createPay2SWebhook,
  getBankingOverview,
  getPay2SSupportedBanks,
  savePay2SConnection,
  verifyPay2SConnection,
} from "@/lib/api/banking";
import type {
  BankAccountCreate,
  BankingOverview,
  Pay2SBankConnectInput,
  Pay2SBankOtpInput,
  Pay2SConnectionInput,
} from "@/lib/types";
import {
  getVietnamBankLogoPath,
  POPULAR_VIETNAM_BANKS,
  VIETNAM_BANKS,
} from "@/lib/vietnam-banks";
import { useAuth } from "@/lib/hooks/useAuth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { isManagementUser } from "@/lib/auth/permissions";
import { createSmartSearchMatcher } from "@/lib/utils/search";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/providers/toast-provider";
import { HeaderControlsPortal } from "@/components/layout/header-controls-portal";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DataSectionEmpty,
  DataSectionError,
} from "@/components/ui/data-section-state";
import {
  editEntityDialogFrameClassName,
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormDialogHeader } from "@/components/ui/form-dialog-header";
import { FormField } from "@/components/ui/form-field";
import { FormSection } from "@/components/ui/form-section";
import { formTextControlClassName } from "@/components/ui/form-text-control";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  getSlideBackdropStyle,
  getSlidePanelStyle,
  useSlidePanelDuration,
} from "@/lib/ui/slide-panel-motion";

const emptyPay2SBank: Pay2SBankConnectInput = {
  bank_type: "openapi",
  bank_short_name: "",
  account_number: "",
  account_name: "",
  cccd: "",
  merchant_id: "",
  acc_mobile: "",
  acc_email: "",
  internet_banking_username: "",
  internet_banking_password: "",
  label: "",
};

const bankingControlClassName = cn(formTextControlClassName, "mt-1.5 block");

type BankOption = {
  code: string;
  shortName: string;
  name: string;
  logo?: string;
};

type BankingTab = "accounts" | "pay2s";
type AccountFilter = "all" | "pay2s" | "external";

function providerStatusLabel(status: string) {
  switch (status) {
    case "connected":
      return "Đã xác thực";
    case "pending_verification":
      return "Chờ xác thực";
    case "error":
      return "Cần kiểm tra";
    case "disabled":
      return "Đang tắt";
    default:
      return "Chưa thiết lập";
  }
}

function readinessBlockerLabel(
  blocker: BankingOverview["readiness"]["blocker"] | undefined,
) {
  switch (blocker) {
    case "provider_disabled":
      return "Chưa bật Pay2S";
    case "qr_disabled":
      return "Chưa bật tạo QR";
    case "provider_not_verified":
      return "Chưa xác thực Pay2S";
    case "receiving_account_missing":
      return "Chưa liên kết tài khoản nhận tiền";
    case "partner_code_missing":
      return "Thiếu Partner Code";
    case "ipn_url_missing":
      return "Chưa có địa chỉ nhận kết quả";
    case "webhook_ingress_disabled":
      return "Chưa bật nhận giao dịch";
    case "auto_post_disabled":
      return "Chưa bật tự động ghi nhận";
    default:
      return "Đã sẵn sàng";
  }
}

export default function BankingPage() {
  const { user } = useAuth();
  const notify = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<BankingTab>("accounts");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [accountTypeDialogOpen, setAccountTypeDialogOpen] = useState(false);
  const [bankPickerTarget, setBankPickerTarget] = useState<
    "pay2s" | "external" | null
  >(null);
  const [externalDialogOpen, setExternalDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<
    BankingOverview["accounts"][number] | null
  >(null);
  const [archiveTarget, setArchiveTarget] = useState<
    BankingOverview["accounts"][number] | null
  >(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [externalBank, setExternalBank] = useState<BankOption | null>(null);
  const [externalForm, setExternalForm] = useState({
    label: "",
    accountNumber: "",
    accountName: "",
    qrImage: null as File | null,
    isDefault: false,
  });
  const qrImageInputRef = useRef<HTMLInputElement>(null);
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [collectionPartnerCode, setCollectionPartnerCode] = useState("");
  const providerFieldsHydrated = useRef(false);
  const [pay2sBank, setPay2sBank] =
    useState<Pay2SBankConnectInput>(emptyPay2SBank);
  const [otp, setOtp] = useState("");
  const [otpContext, setOtpContext] = useState<Pay2SBankOtpInput | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["banking-overview", "self"],
    queryFn: getBankingOverview,
    enabled: Boolean(user) && isManagementUser(user),
    staleTime: 15_000,
  });
  const pay2sBanksQuery = useQuery({
    queryKey: ["pay2s-supported-banks"],
    queryFn: getPay2SSupportedBanks,
    enabled: Boolean(user) && isManagementUser(user),
    staleTime: 15 * 60_000,
  });

  useEffect(() => {
    const provider = overviewQuery.data?.provider;
    if (!provider || providerFieldsHydrated.current) return;

    setMerchantId(provider.merchant_id ?? "");
    setCollectionPartnerCode(
      provider.collection_partner_code ?? provider.partner_code ?? "",
    );
    providerFieldsHydrated.current = true;
  }, [overviewQuery.data?.provider]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["banking-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["ops", "overview"] });
  };

  const archiveMutation = useMutation({
    mutationFn: archiveBankAccount,
    onSuccess: () => {
      notify.success("Đã ngừng sử dụng tài khoản ngân hàng.");
      setArchiveTarget(null);
      setSelectedAccount(null);
      invalidate();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể cập nhật tài khoản.")),
  });

  const providerMutation = useMutation({
    mutationFn: (payload: Pay2SConnectionInput) =>
      savePay2SConnection(payload),
    onSuccess: () => {
      notify.success(
        "Đã lưu cấu hình Pay2S. Hãy bấm xác thực để kiểm tra kết nối.",
      );
      setAccessKey("");
      setSecretKey("");
      invalidate();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể lưu kết nối Pay2S.")),
  });

  const verifyMutation = useMutation({
    mutationFn: verifyPay2SConnection,
    onSuccess: () => {
      notify.success("Pay2S đã xác thực thành công.");
      invalidate();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể xác thực Pay2S.")),
  });

  const pay2sBankMutation = useMutation({
    mutationFn: (payload: Pay2SBankConnectInput) =>
      connectPay2SBank(payload),
    onSuccess: (response) => {
      if (response.otp_required) {
        setOtpContext({
          bank_type: pay2sBank.bank_type,
          bank_short_name: pay2sBank.bank_short_name,
          account_number: pay2sBank.account_number,
          otp: "",
          merchant_id: pay2sBank.merchant_id || undefined,
          internet_banking_username:
            pay2sBank.internet_banking_username || undefined,
          internet_banking_password:
            pay2sBank.internet_banking_password || undefined,
        });
        notify.success("Pay2S đã gửi OTP. Nhập OTP để hoàn tất liên kết.");
      } else {
        notify.success("Đã liên kết ngân hàng Pay2S và đồng bộ tài khoản.");
        setPay2sBank(emptyPay2SBank);
        invalidate();
      }
    },
    onError: (error) =>
      notify.error(
        getApiErrorMessage(error, "Không thể liên kết ngân hàng Pay2S."),
      ),
  });

  const otpMutation = useMutation({
    mutationFn: (payload: Pay2SBankOtpInput) =>
      confirmPay2SBankOtp(payload),
    onSuccess: () => {
      notify.success("Đã xác nhận OTP và liên kết ngân hàng.");
      setOtp("");
      setOtpContext(null);
      setPay2sBank(emptyPay2SBank);
      invalidate();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể xác nhận OTP.")),
  });

  const webhookMutation = useMutation({
    mutationFn: createPay2SWebhook,
    onSuccess: () => {
      notify.success("Đã bật đồng bộ giao dịch cho tài khoản.");
      invalidate();
    },
    onError: (error) =>
      notify.error(getApiErrorMessage(error, "Không thể bật đồng bộ.")),
  });

  const createExternalMutation = useMutation({
    mutationFn: ({
      payload,
      qrImage,
    }: {
      payload: BankAccountCreate;
      qrImage: File | null;
    }) => createManualBankAccount(payload, qrImage),
    onSuccess: () => {
      notify.success("Đã thêm tài khoản nhận tiền thủ công.");
      setExternalDialogOpen(false);
      setExternalBank(null);
      setExternalForm({
        label: "",
        accountNumber: "",
        accountName: "",
        qrImage: null,
        isDefault: false,
      });
      if (qrImageInputRef.current) qrImageInputRef.current.value = "";
      invalidate();
    },
    onError: (error) =>
      notify.error(
        getApiErrorMessage(error, "Không thể thêm tài khoản ngân hàng."),
      ),
  });

  const activeAccounts = useMemo(
    () => overviewQuery.data?.accounts.filter((item) => item.is_active) ?? [],
    [overviewQuery.data?.accounts],
  );
  const visibleAccounts = useMemo(
    () =>
      activeAccounts.filter(
        (item) =>
          accountFilter === "all" || item.connection_type === accountFilter,
      ),
    [accountFilter, activeAccounts],
  );
  const pay2sBankOptions = useMemo(
    () =>
      (pay2sBanksQuery.data?.banks ?? []).map((bank) => {
        const catalogBank = findVietnamBank(
          bank.code,
          bank.short_name,
          bank.name,
        );
        return {
          code: bank.code,
          shortName: bank.short_name,
          name: bank.name,
          logo: catalogBank
            ? getVietnamBankLogoPath(catalogBank.code)
            : undefined,
        };
      }),
    [pay2sBanksQuery.data?.banks],
  );
  const selectedPay2sBank = findBankOption(
    pay2sBankOptions,
    pay2sBank.bank_short_name,
  );
  const vietnamBankOptions = useMemo(
    () =>
      POPULAR_VIETNAM_BANKS.map((bank) => ({
        code: bank.code,
        shortName: bank.shortName,
        name: bank.name,
        logo: getVietnamBankLogoPath(bank.code),
      })),
    [],
  );
  if (!user || !isManagementUser(user)) return null;

  function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: Pay2SConnectionInput = {
      access_key: accessKey || undefined,
      secret_key: secretKey || undefined,
      merchant_id: merchantId || undefined,
      collection_partner_code: collectionPartnerCode || undefined,
      plan: overviewQuery.data?.provider.plan ?? "unconfirmed",
    };
    providerMutation.mutate(payload);
  }

  function submitPay2SBank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pay2sBank.bank_short_name) {
      notify.error("Hãy chọn ngân hàng trước khi liên kết Pay2S.");
      setBankPickerTarget("pay2s");
      return;
    }
    pay2sBankMutation.mutate(pay2sBank);
  }

  function selectBank(bank: BankOption) {
    if (bankPickerTarget === "pay2s") {
      // Pay2S expects the provider's short code (for example `VCB`), while
      // the picker still shows the friendly bank name to the user.
      setPay2sBank((current) => ({ ...current, bank_short_name: bank.code }));
    } else if (bankPickerTarget === "external") {
      setExternalBank(bank);
    }
    setBankPickerTarget(null);
  }

  function submitExternalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!externalBank) {
      notify.error("Hãy chọn ngân hàng trước khi lưu tài khoản.");
      return;
    }
    createExternalMutation.mutate({
      payload: {
        label:
          externalForm.label.trim() || `${externalBank.shortName} · Thủ công`,
        bank_code: externalBank.code,
        bank_name: externalBank.name,
        account_number: externalForm.accountNumber,
        account_name: externalForm.accountName.trim().toUpperCase(),
        qr_source_url: null,
        is_default: externalForm.isDefault,
      },
      qrImage: externalForm.qrImage,
    });
  }

  function selectExternalQrImage(file: File | null) {
    if (!file) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      notify.error("Ảnh QR phải là PNG, JPG hoặc WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify.error("Ảnh QR không được vượt quá 2 MB.");
      return;
    }
    setExternalForm((current) => ({ ...current, qrImage: file }));
  }

  function focusPay2SConnection() {
    setActiveTab("pay2s");
    window.requestAnimationFrame(() => {
      document
        .getElementById("pay2s-connection-section")
        ?.focus({ preventScroll: true });
    });
  }

  function openPay2SBankForm() {
    setActiveTab("pay2s");
    window.requestAnimationFrame(() => {
      document
        .getElementById("pay2s-bank-link-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function openAddAccountFlow() {
    setAccountTypeDialogOpen(true);
  }

  return (
    <div className="font-body-ui flex min-h-0 flex-col gap-3 md:h-full md:overflow-hidden">
      <HeaderControlsPortal>
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setGuideOpen(true)}
          >
            <RiBookOpenLine className="h-3.5 w-3.5" aria-hidden="true" />
            Hướng dẫn
          </Button>
          <Button
            type="button"
            onClick={openAddAccountFlow}
          >
            <RiAddLine className="h-3.5 w-3.5" aria-hidden="true" />
            Thêm tài khoản
          </Button>
        </div>
      </HeaderControlsPortal>

      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Thanh toán
          </p>
          <h1 className="mt-1 text-xl font-bold text-gray-950 sm:text-2xl">
            Ngân hàng
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
            Quản lý tài khoản nhận tiền và kết nối Pay2S.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={() => setGuideOpen(true)}
          >
            <RiBookOpenLine className="h-3.5 w-3.5" aria-hidden="true" />
            Hướng dẫn
          </Button>
          <Button
            type="button"
            onClick={openAddAccountFlow}
          >
            <RiAddLine className="h-3.5 w-3.5" aria-hidden="true" />
            Thêm
          </Button>
        </div>
      </header>

      <nav
        aria-label="Khu vực ngân hàng"
        className="scrollbar-hidden flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5"
      >
        <button
          id="banking-accounts-tab"
          type="button"
          aria-pressed={activeTab === "accounts"}
          aria-controls="banking-accounts-panel"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setActiveTab("accounts")}
          className={cn(
            "font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            activeTab === "accounts"
              ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
              : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary",
          )}
        >
          Tài khoản nhận tiền
          <span
            className={cn(
              "min-w-4 text-right text-[12px] font-semibold tabular-nums",
              activeTab === "accounts" ? "text-primary" : "text-gray-500",
            )}
          >
            {activeAccounts.length}
          </span>
        </button>
        <button
          id="banking-pay2s-tab"
          type="button"
          aria-pressed={activeTab === "pay2s"}
          aria-controls="banking-pay2s-panel"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setActiveTab("pay2s")}
          className={cn(
            "font-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            activeTab === "pay2s"
              ? "bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/20"
              : "font-medium text-gray-600 hover:bg-primary-soft/60 hover:text-primary",
          )}
        >
          Kết nối Pay2S
          <span className="sr-only">
            Trạng thái:{" "}
            {overviewQuery.data?.provider.status === "connected"
              ? "đã kết nối"
              : "chưa kết nối"}
          </span>
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              overviewQuery.data?.provider.status === "connected"
                ? "bg-emerald-500"
                : "bg-gray-300",
            )}
            aria-hidden="true"
          />
        </button>
      </nav>

      {activeTab === "accounts" ? (
        <section
          id="banking-accounts-panel"
          className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white md:flex-1"
          aria-labelledby="bank-accounts-heading"
        >
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-5">
            <div>
              <h2
                id="bank-accounts-heading"
                className="text-base font-bold text-gray-950"
              >
                Tài khoản nhận tiền
              </h2>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                Tài khoản Pay2S dùng để tạo QR và tự động ghi nhận; tài khoản
                thủ công dùng khi Admin tự xác nhận học phí.
              </p>
            </div>
            <div
              className="scrollbar-hidden flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-1"
              aria-label="Lọc tài khoản"
            >
              {(["all", "pay2s", "external"] as const).map((filter) => {
                const count =
                  filter === "all"
                    ? activeAccounts.length
                    : activeAccounts.filter(
                        (item) => item.connection_type === filter,
                      ).length;
                const label =
                  filter === "all"
                    ? "Tất cả"
                    : filter === "pay2s"
                      ? "Pay2S"
                      : "Thủ công";
                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={accountFilter === filter}
                    onClick={() => setAccountFilter(filter)}
                    className={cn(
                      "min-h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      accountFilter === filter
                        ? "bg-white font-semibold text-primary shadow-sm"
                        : "text-gray-600 hover:text-gray-900",
                    )}
                  >
                    {label}{" "}
                    <span className="tabular-nums text-gray-500">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="scrollbar-hidden min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain">
            {overviewQuery.isPending ? (
              <div
                className="space-y-2 p-4 sm:p-5"
                aria-busy="true"
                aria-live="polite"
              >
                {["a", "b", "c"].map((key) => (
                  <div
                    key={key}
                    className="h-24 animate-pulse rounded-lg border border-gray-100 bg-gray-50"
                  />
                ))}
              </div>
            ) : overviewQuery.isError ? (
              <DataSectionError
                className="m-4 md:h-full"
                title="Không tải được tài khoản ngân hàng"
                description="Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại."
                isRetrying={overviewQuery.isFetching}
                onRetry={() => void overviewQuery.refetch()}
              />
            ) : visibleAccounts.length === 0 ? (
              <DataSectionEmpty
                className="m-4 md:h-full"
                icon={RiBankCardLine}
                title={
                  activeAccounts.length === 0
                    ? "Chưa có tài khoản nhận tiền"
                    : "Không có tài khoản phù hợp"
                }
                description={
                  activeAccounts.length === 0
                    ? undefined
                    : "Thử chọn bộ lọc khác để xem các tài khoản đang hoạt động."
                }
                actionLabel={
                  activeAccounts.length === 0 ? "Thêm tài khoản" : undefined
                }
                onAction={
                  activeAccounts.length === 0 ? openAddAccountFlow : undefined
                }
              />
            ) : (
              <div
                className="divide-y divide-gray-100"
                role="list"
                aria-label="Danh sách tài khoản nhận tiền"
              >
                {visibleAccounts.map((item) => {
                  const isPay2S = item.connection_type === "pay2s";
                  return (
                    <article
                      key={item.id}
                      role="listitem"
                      className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-gray-50/70 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5 sm:px-5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold text-gray-950">
                            {item.label}
                          </h3>
                          {item.is_default ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Mặc định
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-semibold",
                              isPay2S
                                ? "bg-primary-soft text-primary"
                                : "bg-gray-100 text-gray-700",
                            )}
                          >
                            {isPay2S
                              ? overviewQuery.data?.readiness
                                  .automatic_recording_ready
                                ? "Pay2S · Tự động"
                                : "Pay2S · Đang thiết lập"
                              : "Thủ công"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">
                          {item.bank_name}
                        </p>
                        <p className="text-sm font-semibold tracking-wide text-gray-950">
                          {item.account_number}
                        </p>
                        <p className="truncate text-xs text-gray-600">
                          {item.account_name}
                          {item.va_number ? ` · VA ${item.va_number}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-600">
                        {isPay2S ? (
                          item.webhook_configured ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700">
                              <RiCheckLine aria-hidden="true" />
                              Đã bật đồng bộ giao dịch
                            </span>
                          ) : (
                            <span className="text-gray-600">
                              Đã liên kết Pay2S
                            </span>
                          )
                        ) : (
                          <span>Admin ghi nhận tại Học phí</span>
                        )}
                        {item.qr_source_url ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                            Có QR gốc
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 sm:justify-end">
                        {item.provider_bank_id &&
                        !item.webhook_configured ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => webhookMutation.mutate(item.id)}
                            disabled={webhookMutation.isPending}
                            className="border-primary/25 text-primary hover:bg-primary-soft"
                          >
                            <RiWebhookLine aria-hidden="true" />
                            {webhookMutation.isPending ? (
                              <LoadingLabel label="Đang bật" />
                            ) : (
                              "Bật đồng bộ"
                            )}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedAccount(item)}
                        >
                          Chi tiết
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          aria-label={`Ngừng sử dụng ${item.label}`}
                          className="text-gray-500 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setArchiveTarget(item)}
                          disabled={archiveMutation.isPending}
                        >
                          <RiDeleteBinLine aria-hidden="true" />
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : (
        <div
          id="banking-pay2s-panel"
          aria-labelledby="banking-pay2s-tab"
          className="scrollbar-hidden min-h-0 overflow-x-hidden overscroll-contain md:flex-1 md:overflow-y-auto"
        >
          <div className="grid gap-3 pb-1 2xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
            <section
              id="pay2s-connection-section"
              tabIndex={-1}
              className="scroll-mt-3 rounded-xl border border-gray-200 bg-white p-4 outline-none sm:p-5"
              aria-labelledby="pay2s-heading"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    id="pay2s-heading"
                    className="text-base font-bold text-gray-950"
                  >
                    Kết nối Pay2S
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Tạo QR và tự động ghi nhận học phí.
                  </p>
                </div>
                <RiLinkM
                  className="h-6 w-6 shrink-0 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <StatusItem
                  label="Kết nối Pay2S"
                  value={
                    overviewQuery.data
                      ? providerStatusLabel(overviewQuery.data.provider.status)
                      : "Chưa có dữ liệu"
                  }
                  loading={overviewQuery.isPending && !overviewQuery.data}
                  tone={
                    overviewQuery.data?.readiness.provider_verified
                      ? "success"
                      : "default"
                  }
                />
                <StatusItem
                  label="Tài khoản nhận tiền"
                  value={
                    overviewQuery.data?.readiness.receiving_account_connected
                      ? "Đã liên kết"
                      : "Chưa liên kết"
                  }
                  loading={overviewQuery.isPending && !overviewQuery.data}
                  tone={
                    overviewQuery.data?.readiness.receiving_account_connected
                      ? "success"
                      : "default"
                  }
                />
                <StatusItem
                  label="Tự động ghi nhận"
                  value={
                    overviewQuery.data?.readiness.automatic_recording_ready
                      ? "Sẵn sàng"
                      : readinessBlockerLabel(
                          overviewQuery.data?.readiness.blocker,
                        )
                  }
                  loading={overviewQuery.isPending && !overviewQuery.data}
                  tone={
                    overviewQuery.data?.readiness.automatic_recording_ready
                      ? "success"
                      : "default"
                  }
                />
              </div>
              {overviewQuery.isError ? (
                <DataSectionError
                  className="mt-4"
                  title="Không tải được cấu hình Pay2S"
                  description="Kết nối dữ liệu đang gián đoạn. Vui lòng thử lại."
                  isRetrying={overviewQuery.isFetching}
                  onRetry={() => void overviewQuery.refetch()}
                />
              ) : null}
              {overviewQuery.data?.provider.last_error ? (
                <p
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800"
                  role="alert"
                >
                  {overviewQuery.data.provider.last_error}
                </p>
              ) : null}

              <form
                autoComplete="off"
                onSubmit={submitProvider}
                className="mt-5 grid gap-4"
              >
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                          1
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold text-gray-950">
                            Nhập thông tin tài khoản Pay2S
                          </h3>
                          <p className="mt-0.5 text-sm leading-5 text-gray-600">
                            Nhập khóa Pay2S của workspace này.
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-label-text text-gray-700">
                          Access Key
                          <input
                            required
                            type="password"
                            autoComplete="new-password"
                            value={accessKey}
                            onChange={(event) =>
                              setAccessKey(event.target.value)
                            }
                            className={bankingControlClassName}
                          />
                        </label>
                        <label className="form-label-text text-gray-700">
                          Secret Key
                          <input
                            required
                            type="password"
                            autoComplete="new-password"
                            value={secretKey}
                            onChange={(event) =>
                              setSecretKey(event.target.value)
                            }
                            className={bankingControlClassName}
                          />
                        </label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-label-text text-gray-700">
                          Merchant ID (nếu Pay2S cấp)
                          <input
                            autoComplete="off"
                            value={merchantId}
                            onChange={(event) =>
                              setMerchantId(event.target.value)
                            }
                            className={bankingControlClassName}
                          />
                        </label>
                        <label className="form-label-text text-gray-700">
                          Partner Code dùng tạo QR
                          <input
                            required
                            autoComplete="off"
                            value={collectionPartnerCode}
                            onChange={(event) =>
                              setCollectionPartnerCode(event.target.value)
                            }
                            placeholder="Theo thông tin Pay2S cung cấp"
                            className={bankingControlClassName}
                          />
                        </label>
                      </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                        2
                      </span>
                      <h3 className="text-sm font-semibold text-gray-950">
                        Lưu và xác thực
                      </h3>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="submit"
                        disabled={
                          providerMutation.isPending ||
                          !accessKey ||
                          !secretKey ||
                          !collectionPartnerCode.trim()
                        }
                      >
                        {providerMutation.isPending ? (
                          <LoadingLabel label="Đang lưu" />
                        ) : (
                          "Lưu cấu hình"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => verifyMutation.mutate()}
                        disabled={
                          verifyMutation.isPending ||
                          overviewQuery.data?.provider.status === "not_configured"
                        }
                      >
                        <RiRefreshLine aria-hidden="true" />
                        {verifyMutation.isPending ? (
                          <LoadingLabel label="Đang kiểm tra" />
                        ) : (
                          "Xác thực"
                        )}
                      </Button>
                    </div>
                  </div>
                </form>
              <p className="mt-4 flex items-start gap-2 text-sm leading-5 text-gray-600">
                <RiLockLine
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                Khóa được mã hóa ở server và không hiển thị lại. Không nhập mật
                khẩu Pay2S tại đây.
              </p>
            </section>

            <aside
              className="rounded-xl border border-primary/20 bg-primary-soft/30 p-4 sm:p-5"
              aria-labelledby="pay2s-guide-summary-heading"
            >
              <div className="flex items-start gap-3">
                <RiInformationLine
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div>
                  <h2
                    id="pay2s-guide-summary-heading"
                    className="text-base font-bold text-gray-950"
                  >
                    Cách kết nối
                  </h2>
                </div>
              </div>
              <ol className="mt-4 space-y-3">
                {[
                  "Lấy Access Key và Secret Key",
                  "Xác thực kết nối trong TPRO",
                  "Liên kết tài khoản nhận tiền",
                  "Chạy thử một yêu cầu học phí",
                ].map((step, index) => (
                  <li
                    key={step}
                    className="flex items-start gap-3 text-sm text-gray-700"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
              <Button
                type="button"
                variant="outline"
                className="mt-5 w-full justify-between border-primary/25 bg-white text-primary hover:bg-white"
                onClick={() => setGuideOpen(true)}
              >
                Xem hướng dẫn đầy đủ <RiArrowRightLine aria-hidden="true" />
              </Button>
            </aside>

            {overviewQuery.data?.provider.status === "connected" ? (
              <section
                id="pay2s-bank-link-section"
                className="scroll-mt-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 2xl:col-span-2"
                aria-labelledby="pay2s-bank-heading"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2
                      id="pay2s-bank-heading"
                      className="text-base font-bold text-gray-950"
                    >
                      Liên kết tài khoản nhận tiền
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-gray-600">
                      Chọn ngân hàng và nhập tài khoản nhận học phí.
                    </p>
                  </div>
                  <RiWebhookLine
                    className="h-6 w-6 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                </div>
                {pay2sBanksQuery.isError ? (
                  <p
                    className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                  >
                    Không tải được danh mục ngân hàng Pay2S.{" "}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => void pay2sBanksQuery.refetch()}
                    >
                      Thử lại
                    </button>
                  </p>
                ) : null}
                <form
                  autoComplete="off"
                  onSubmit={submitPay2SBank}
                  className="mt-4 grid gap-3 md:grid-cols-2"
                >
                  <label className="form-label-text text-gray-700">
                    Cách kết nối
                    <select
                      value={pay2sBank.bank_type}
                      onChange={(event) =>
                        setPay2sBank({
                          ...emptyPay2SBank,
                          bank_type: event.target.value as
                            "openapi" | "personal",
                          bank_short_name: pay2sBank.bank_short_name,
                          account_number: pay2sBank.account_number,
                          label: pay2sBank.label,
                        })
                      }
                      className={cn(bankingControlClassName, "appearance-auto")}
                    >
                      <option value="openapi">
                        Kết nối trực tiếp (OpenAPI)
                      </option>
                      <option value="personal">Internet Banking cá nhân</option>
                    </select>
                  </label>
                  <div className="form-label-text text-gray-700">
                    <span className="block">Ngân hàng</span>
                    <BankPickerTrigger
                      value={selectedPay2sBank?.shortName ?? ""}
                      placeholder="Chọn ngân hàng"
                      loading={pay2sBanksQuery.isPending}
                      selected={Boolean(selectedPay2sBank)}
                      onClick={() => setBankPickerTarget("pay2s")}
                      disabled={
                        pay2sBanksQuery.isPending || pay2sBanksQuery.isError
                      }
                    />
                  </div>
                  <label className="form-label-text text-gray-700">
                    Số tài khoản
                    <input
                      required
                      autoComplete="off"
                      inputMode="numeric"
                      value={pay2sBank.account_number}
                      onChange={(event) =>
                        setPay2sBank({
                          ...pay2sBank,
                          account_number: event.target.value.replace(/\D/g, ""),
                        })
                      }
                      className={bankingControlClassName}
                    />
                  </label>
                  <label className="form-label-text text-gray-700">
                    Tên gợi nhớ{" "}
                    <span className="font-normal text-gray-500">
                      (không bắt buộc)
                    </span>
                    <input
                      autoComplete="off"
                      value={pay2sBank.label ?? ""}
                      onChange={(event) =>
                        setPay2sBank({
                          ...pay2sBank,
                          label: event.target.value,
                        })
                      }
                      placeholder="Ví dụ: Tài khoản học phí"
                      className={bankingControlClassName}
                    />
                  </label>

                  {pay2sBank.bank_type === "openapi" ? (
                    <>
                      <label className="form-label-text text-gray-700">
                        Tên chủ tài khoản
                        <input
                          required
                          autoComplete="off"
                          value={pay2sBank.account_name ?? ""}
                          onChange={(event) =>
                            setPay2sBank({
                              ...pay2sBank,
                              account_name: event.target.value.toUpperCase(),
                            })
                          }
                          className={bankingControlClassName}
                        />
                      </label>
                      <label className="form-label-text text-gray-700">
                        Số điện thoại đăng ký ngân hàng
                        <input
                          required
                          autoComplete="off"
                          inputMode="tel"
                          value={pay2sBank.acc_mobile ?? ""}
                          onChange={(event) =>
                            setPay2sBank({
                              ...pay2sBank,
                              acc_mobile: event.target.value.replace(
                                /[^0-9+]/g,
                                "",
                              ),
                            })
                          }
                          className={bankingControlClassName}
                        />
                      </label>
                      {pay2sBank.bank_short_name === "BIDV" ? (
                        <>
                          <label className="form-label-text text-gray-700">
                            CCCD
                            <input
                              required
                              autoComplete="off"
                              inputMode="numeric"
                              value={pay2sBank.cccd ?? ""}
                              onChange={(event) =>
                                setPay2sBank({
                                  ...pay2sBank,
                                  cccd: event.target.value.replace(/\D/g, ""),
                                })
                              }
                              className={bankingControlClassName}
                            />
                          </label>
                          <label className="form-label-text text-gray-700">
                            Merchant ID BIDV
                            <input
                              required
                              autoComplete="off"
                              value={pay2sBank.merchant_id ?? ""}
                              onChange={(event) =>
                                setPay2sBank({
                                  ...pay2sBank,
                                  merchant_id: event.target.value,
                                })
                              }
                              className={bankingControlClassName}
                            />
                          </label>
                          <label className="form-label-text text-gray-700 md:col-span-2">
                            Email đăng ký ngân hàng
                            <input
                              required
                              inputMode="email"
                              autoComplete="off"
                              value={pay2sBank.acc_email ?? ""}
                              onChange={(event) =>
                                setPay2sBank({
                                  ...pay2sBank,
                                  acc_email: event.target.value,
                                })
                              }
                              className={bankingControlClassName}
                            />
                          </label>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label className="form-label-text text-gray-700">
                        Tên đăng nhập Internet Banking
                        <input
                          required
                          autoComplete="off"
                          value={pay2sBank.internet_banking_username ?? ""}
                          onChange={(event) =>
                            setPay2sBank({
                              ...pay2sBank,
                              internet_banking_username: event.target.value,
                            })
                          }
                          className={bankingControlClassName}
                        />
                      </label>
                      <label className="form-label-text text-gray-700">
                        Mật khẩu Internet Banking
                        <input
                          required
                          type="password"
                          autoComplete="new-password"
                          value={pay2sBank.internet_banking_password ?? ""}
                          onChange={(event) =>
                            setPay2sBank({
                              ...pay2sBank,
                              internet_banking_password: event.target.value,
                            })
                          }
                          className={bankingControlClassName}
                        />
                      </label>
                      <p className="md:col-span-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
                        <RiLockLine
                          className="mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        Thông tin đăng nhập chỉ được gửi đến Pay2S trong lần
                        liên kết này và không được lưu trong TPRO.
                      </p>
                    </>
                  )}
                  <div className="flex justify-end md:col-span-2">
                    <Button
                      type="submit"
                      disabled={
                        pay2sBankMutation.isPending ||
                        pay2sBanksQuery.isPending ||
                        pay2sBanksQuery.isError
                      }
                    >
                      {pay2sBankMutation.isPending ? (
                        <LoadingLabel label="Đang liên kết" />
                      ) : (
                        "Liên kết tài khoản"
                      )}
                    </Button>
                  </div>
                </form>
                {otpContext ? (
                  <form
                    autoComplete="off"
                    onSubmit={(event) => {
                      event.preventDefault();
                      otpMutation.mutate({ ...otpContext, otp });
                    }}
                    className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
                  >
                    <label className="form-label-text text-amber-950">
                      Mã OTP
                      <input
                        required
                        autoComplete="off"
                        inputMode="numeric"
                        value={otp}
                        onChange={(event) =>
                          setOtp(event.target.value.replace(/\D/g, ""))
                        }
                        className={cn(
                          bankingControlClassName,
                          "w-44 border-amber-300 focus:border-amber-500 focus:ring-amber-200",
                        )}
                      />
                    </label>
                    <Button type="submit" disabled={otpMutation.isPending}>
                      {otpMutation.isPending ? (
                        <LoadingLabel label="Đang xác nhận" />
                      ) : (
                        "Xác nhận OTP"
                      )}
                    </Button>
                  </form>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      )}

      {accountTypeDialogOpen ? (
        <FormDialogShell
          title="Thêm tài khoản nhận tiền"
          subtitle="Chọn cách hệ thống sẽ ghi nhận khoản thanh toán."
          width="standard"
          onClose={() => setAccountTypeDialogOpen(false)}
        >
          <FormDialogBody className="grid !space-y-0 gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="flex h-full min-h-36 flex-col rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary/40 hover:bg-primary-soft/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              onClick={() => {
                setAccountTypeDialogOpen(false);
                setExternalDialogOpen(true);
              }}
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
                <RiBankCardLine className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="mt-3 block font-semibold text-gray-950">
                Tài khoản thủ công
              </span>
              <span className="mt-1 block text-sm leading-5 text-gray-600">
                Admin chọn tài khoản nhận tiền khi tự xác nhận học phí.
              </span>
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-primary">
                Thêm tài khoản thủ công
                <RiArrowRightLine aria-hidden="true" />
              </span>
            </button>
            <button
              type="button"
              className="flex h-full min-h-36 flex-col rounded-xl border border-primary/30 bg-primary-soft/25 p-4 text-left transition hover:bg-primary-soft/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              onClick={() => {
                setAccountTypeDialogOpen(false);
                if (overviewQuery.data?.provider.status === "connected") {
                  openPay2SBankForm();
                } else {
                  focusPay2SConnection();
                }
              }}
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white">
                <RiWebhookLine className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="mt-3 block font-semibold text-gray-950">
                Tài khoản Pay2S
              </span>
              <span className="mt-1 block text-sm leading-5 text-gray-600">
                Tạo QR riêng và tự động ghi nhận học phí khi đã sẵn sàng.
              </span>
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-primary">
                {overviewQuery.data?.provider.status === "connected"
                  ? "Liên kết ngân hàng"
                  : "Thiết lập Pay2S"}
                <RiArrowRightLine aria-hidden="true" />
              </span>
            </button>
          </FormDialogBody>
          <FormDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAccountTypeDialogOpen(false)}
            >
              Đóng
            </Button>
          </FormDialogFooter>
        </FormDialogShell>
      ) : null}

      {externalDialogOpen ? (
        <FormDialogShell
          title="Thêm tài khoản thủ công"
          subtitle="Dùng khi Admin tự xác nhận học phí và chọn tài khoản đã nhận tiền."
          width="standard"
          isBusy={createExternalMutation.isPending}
          onClose={() => setExternalDialogOpen(false)}
        >
          <form
            onSubmit={submitExternalAccount}
            className="flex min-h-0 flex-1 flex-col"
          >
            <FormDialogBody>
              <FormSection label="Thông tin tài khoản" order={1}>
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <FormField label="Ngân hàng" labelId="manual-bank-label">
                    <BankPickerTrigger
                      value={externalBank?.shortName ?? ""}
                      placeholder="Chọn ngân hàng"
                      selected={Boolean(externalBank)}
                      onClick={() => setBankPickerTarget("external")}
                      ariaLabelledBy="manual-bank-label"
                    />
                  </FormField>
                  <FormField
                    controlId="manual-account-label"
                    label="Tên gợi nhớ"
                  >
                    <input
                      id="manual-account-label"
                      autoComplete="off"
                      className={formTextControlClassName}
                      value={externalForm.label}
                      onChange={(event) =>
                        setExternalForm((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      placeholder="Tài khoản chính"
                    />
                  </FormField>
                  <FormField
                    controlId="manual-account-owner"
                    label="Tên chủ tài khoản"
                  >
                    <input
                      id="manual-account-owner"
                      autoComplete="off"
                      required
                      className={formTextControlClassName}
                      value={externalForm.accountName}
                      onChange={(event) =>
                        setExternalForm((current) => ({
                          ...current,
                          accountName: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </FormField>
                  <FormField
                    controlId="manual-account-number"
                    label="Số tài khoản"
                  >
                    <input
                      id="manual-account-number"
                      autoComplete="off"
                      required
                      inputMode="numeric"
                      className={formTextControlClassName}
                      value={externalForm.accountNumber}
                      onChange={(event) =>
                        setExternalForm((current) => ({
                          ...current,
                          accountNumber: event.target.value.replace(/\D/g, ""),
                        }))
                      }
                    />
                  </FormField>
                  <FormField
                    className="sm:col-span-2"
                    label="QR gốc (tuỳ chọn)"
                    hint="Tải PNG, JPG hoặc WebP (tối đa 2 MB). Ảnh chỉ hiển thị cho quản trị viên của đơn vị."
                  >
                    <input
                      ref={qrImageInputRef}
                      type="file"
                      autoComplete="off"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        selectExternalQrImage(event.target.files?.[0] ?? null);
                        event.currentTarget.value = "";
                      }}
                    />
                    <div
                      className={cn(
                        bankingControlClassName,
                        "flex min-h-10 items-center justify-between gap-3 px-3 py-2",
                      )}
                    >
                      {externalForm.qrImage ? (
                        <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
                          <RiImageAddLine
                            className="h-4 w-4 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          <span className="truncate font-medium">
                            {externalForm.qrImage.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">
                          Chưa chọn ảnh QR
                        </span>
                      )}
                      <span className="flex shrink-0 items-center gap-1.5">
                        {externalForm.qrImage ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="px-2 text-gray-600"
                            onClick={() =>
                              setExternalForm((current) => ({
                                ...current,
                                qrImage: null,
                              }))
                            }
                          >
                            <RiCloseLine
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                            Bỏ ảnh
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => qrImageInputRef.current?.click()}
                        >
                          {externalForm.qrImage ? "Chọn lại" : "Chọn ảnh"}
                        </Button>
                      </span>
                    </div>
                  </FormField>
                  <div className="inline-flex min-h-8 w-fit items-center gap-2 justify-self-start text-sm font-medium text-gray-800 sm:col-span-2">
                    <input
                      autoComplete="off"
                      type="checkbox"
                      aria-label="Đặt làm tài khoản mặc định"
                      checked={externalForm.isDefault}
                      onChange={(event) =>
                        setExternalForm((current) => ({
                          ...current,
                          isDefault: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span>Đặt làm tài khoản mặc định</span>
                  </div>
                </div>
              </FormSection>
            </FormDialogBody>
            <FormDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExternalDialogOpen(false)}
                disabled={createExternalMutation.isPending}
              >
                Huỷ
              </Button>
              <Button
                type="submit"
                disabled={
                  createExternalMutation.isPending ||
                  !externalBank ||
                  !externalForm.accountNumber ||
                  !externalForm.accountName
                }
              >
                {createExternalMutation.isPending ? (
                  <LoadingLabel label="Đang lưu" />
                ) : (
                  "Lưu tài khoản"
                )}
              </Button>
            </FormDialogFooter>
          </form>
        </FormDialogShell>
      ) : null}

      {selectedAccount ? (
        <FormDialogShell
          title={selectedAccount.label}
          subtitle={`${selectedAccount.bank_name} · ${selectedAccount.account_number}`}
          width="standard"
          onClose={() => setSelectedAccount(null)}
        >
          <FormDialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailItem
                label="Phương thức"
                value={
                  selectedAccount.connection_type === "pay2s"
                    ? "Pay2S"
                    : "Thủ công"
                }
              />
              <DetailItem
                label="Chủ tài khoản"
                value={selectedAccount.account_name}
              />
              <DetailItem
                label="Số tài khoản"
                value={selectedAccount.account_number}
              />
              <DetailItem
                label="Trạng thái"
                value={
                  selectedAccount.connection_type === "pay2s"
                    ? overviewQuery.data?.readiness.automatic_recording_ready
                      ? "Tự động ghi nhận học phí"
                      : "Đang hoàn tất thiết lập"
                    : "Admin ghi nhận tại Học phí"
                }
              />
            </div>
            {selectedAccount.va_number ? (
              <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Số tài khoản định danh:{" "}
                <strong>{selectedAccount.va_number}</strong>
              </p>
            ) : null}
            {selectedAccount.qr_source_url ? (
              <div className="mt-4">
                <p className="text-sm font-semibold text-gray-800">QR gốc</p>
                <Image
                  unoptimized
                  src={selectedAccount.qr_source_url}
                  alt={`QR gốc ${selectedAccount.label}`}
                  width={192}
                  height={192}
                  className="mt-2 h-48 w-48 rounded-lg border border-gray-200 bg-white object-contain p-2"
                />
              </div>
            ) : null}
          </FormDialogBody>
          <FormDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedAccount(null)}
            >
              Đóng
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setArchiveTarget(selectedAccount)}
            >
              Ngừng sử dụng
            </Button>
          </FormDialogFooter>
        </FormDialogShell>
      ) : null}

      {guideOpen ? (
        <FormDialogShell
          title="Hướng dẫn kết nối Pay2S"
          subtitle={
            <span className="text-sm leading-6 text-gray-700">
              Kết nối Pay2S để tạo QR và tự động ghi nhận học phí.
            </span>
          }
          width="lg"
          onClose={() => setGuideOpen(false)}
          frameProps={{ className: editEntityDialogFrameClassName }}
        >
          <FormDialogBody className="space-y-5 bg-gray-50/60">
            <section
              className="rounded-xl border border-primary/15 bg-primary-soft/40 p-4"
              aria-labelledby="pay2s-guide-intro"
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
                  <RiInformationLine className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2
                    id="pay2s-guide-intro"
                    className="text-base font-bold text-gray-950"
                  >
                    Sau khi hoàn tất
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-800">
                    Tại trang Học phí, Admin chọn khoản cần thu, tạo QR rồi gửi
                    cho phụ huynh. TPRO chỉ tự ghi nhận khi nội dung chuyển
                    khoản, số tiền và tài khoản nhận đều khớp.
                  </p>
                </div>
              </div>
            </section>

            <section aria-labelledby="pay2s-guide-steps">
              <div className="mb-3">
                <div>
                  <h2
                    id="pay2s-guide-steps"
                    className="text-base font-bold text-gray-950"
                  >
                    4 bước thiết lập
                  </h2>
                </div>
              </div>
              <div className="grid items-stretch gap-3 md:grid-cols-2">
                <GuideStep
                  number="1"
                  title="Lấy khóa Pay2S"
                  purpose="Dùng tài khoản Pay2S riêng của đơn vị nhận tiền."
                  items={[
                    "Đăng ký hoặc đăng nhập Pay2S.",
                    "Kiểm tra gói cho phép liên kết ngân hàng và nhận callback.",
                    "Sao chép Access Key, Secret Key và Partner Code trong khu vực Partner/API.",
                  ]}
                  result="Có đủ Access Key, Secret Key và Partner Code."
                  href="https://pay2s.vn/client/signup"
                  label="Mở Pay2S"
                  icon={<RiLinkM className="h-4 w-4" aria-hidden="true" />}
                />
                <GuideStep
                  number="2"
                  title="Lưu và xác thực trong TPRO"
                  purpose="Kết nối đúng tài khoản Pay2S của đơn vị."
                  items={[
                    "Mở tab Kết nối Pay2S.",
                    "Nhập ba thông tin khóa đã lấy.",
                    "Bấm Lưu cấu hình, sau đó bấm Xác thực.",
                  ]}
                  result="Kết nối hiển thị Đã xác thực."
                  icon={
                    <RiRefreshLine className="h-4 w-4" aria-hidden="true" />
                  }
                />
                <GuideStep
                  number="3"
                  title="Liên kết tài khoản nhận tiền"
                  purpose="Liên kết đúng tài khoản sẽ nhận tiền từ QR."
                  items={[
                    "Chọn ngân hàng Pay2S hỗ trợ.",
                    "Nhập thông tin Pay2S yêu cầu.",
                    "Xác nhận OTP nếu ngân hàng yêu cầu.",
                  ]}
                  result="Tài khoản Pay2S xuất hiện đúng thông tin."
                  icon={
                    <RiBankCardLine className="h-4 w-4" aria-hidden="true" />
                  }
                />
                <GuideStep
                  number="4"
                  title="Tạo QR và gửi cho phụ huynh"
                  purpose="Tạo đúng một QR riêng cho từng yêu cầu học phí còn mở."
                  items={[
                    "Tại Học phí, tạo yêu cầu thanh toán.",
                    "Tạo QR rồi gửi QR đó cho phụ huynh.",
                    "TPRO tự dùng tài khoản Pay2S đã liên kết để nhận tiền.",
                    "Theo dõi trạng thái yêu cầu chuyển sang Đã thanh toán.",
                  ]}
                  result="Học phí được tự động ghi nhận khi giao dịch hợp lệ."
                  icon={<RiCheckLine className="h-4 w-4" aria-hidden="true" />}
                />
              </div>
            </section>
          </FormDialogBody>
          <FormDialogFooter>
            <Button
              type="button"
              onClick={() => setGuideOpen(false)}
            >
              Đã hiểu
            </Button>
          </FormDialogFooter>
        </FormDialogShell>
      ) : null}

      <ConfirmationDialog
        open={Boolean(archiveTarget)}
        title="Ngừng sử dụng tài khoản?"
        description={
          archiveTarget
            ? `${archiveTarget.label} sẽ không còn xuất hiện trong danh sách tài khoản đang hoạt động. Lịch sử giao dịch vẫn được giữ lại.`
            : ""
        }
        confirmLabel="Ngừng sử dụng"
        tone="danger"
        isPending={archiveMutation.isPending}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) archiveMutation.mutate(archiveTarget.id);
        }}
      />

      <BankPickerDialog
        open={bankPickerTarget === "pay2s"}
        selectedBank={selectedPay2sBank}
        banks={pay2sBankOptions}
        scope="pay2s"
        onClose={() => setBankPickerTarget(null)}
        onSelect={selectBank}
      />
      <BankPickerDialog
        open={bankPickerTarget === "external"}
        selectedBank={externalBank ?? undefined}
        banks={vietnamBankOptions}
        scope="manual"
        onClose={() => setBankPickerTarget(null)}
        onSelect={selectBank}
      />
    </div>
  );
}

function normalizeBankIdentity(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("vi-VN");
}

function findVietnamBank(...values: Array<string | null | undefined>) {
  const identities = values.map(normalizeBankIdentity).filter(Boolean);
  if (identities.length === 0) return undefined;
  return VIETNAM_BANKS.find((bank) =>
    [bank.code, bank.shortName, bank.name].some((value) =>
      identities.includes(normalizeBankIdentity(value)),
    ),
  );
}

function findBankOption(
  banks: readonly BankOption[],
  ...values: Array<string | null | undefined>
) {
  const identities = values.map(normalizeBankIdentity).filter(Boolean);
  if (identities.length === 0) return undefined;
  return banks.find((bank) =>
    [bank.code, bank.shortName, bank.name].some((value) =>
      identities.includes(normalizeBankIdentity(value)),
    ),
  );
}

function BankPickerTrigger({
  value,
  placeholder,
  loading = false,
  selected,
  onClick,
  disabled = false,
  ariaLabelledBy,
}: {
  value: string;
  placeholder: string;
  loading?: boolean;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  ariaLabelledBy?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      aria-label={ariaLabelledBy ? undefined : loading ? "Đang tải ngân hàng" : value || placeholder}
      aria-labelledby={ariaLabelledBy}
      data-selected={selected || undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "mt-1.5 h-8 w-full justify-between rounded-md border-gray-200 bg-white px-3 font-normal hover:border-gray-300 hover:bg-gray-50",
        !value && "text-gray-400",
      )}
    >
      {loading ? <LoadingLabel label="Đang tải ngân hàng" /> : <span className="truncate text-left">{value || placeholder}</span>}
      <RiArrowDownSLine
        className="h-4 w-4 shrink-0 text-gray-500"
        aria-hidden="true"
      />
    </Button>
  );
}

function StatusItem({
  label,
  value,
  loading = false,
  tone,
}: {
  label: string;
  value: string;
  loading?: boolean;
  tone: "default" | "success";
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold",
          tone === "success" ? "text-emerald-700" : "text-gray-900",
        )}
      >
        {loading ? <LoadingLabel label="Đang tải" /> : value}
      </p>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function BankPickerDialog({
  open,
  selectedBank,
  banks: options,
  scope,
  onClose,
  onSelect,
}: {
  open: boolean;
  selectedBank?: BankOption;
  banks: readonly BankOption[];
  scope: "manual" | "pay2s";
  onClose: () => void;
  onSelect: (bank: BankOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [isRendered, setIsRendered] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropPointerDownRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  const transitionDuration = useSlidePanelDuration(panelRef, isRendered);
  const matchesBank = useMemo(() => createSmartSearchMatcher(query), [query]);
  const banks = useMemo(
    () =>
      options
        .filter((bank) => matchesBank([bank.shortName, bank.code, bank.name]))
        .slice()
        .sort((left, right) =>
          left.shortName.localeCompare(right.shortName, "vi-VN"),
        ),
    [matchesBank, options],
  );

  useEffect(() => {
    if (open) {
      setIsRendered(true);
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
      const frame = window.requestAnimationFrame(() => {
        setIsVisible(true);
        searchInputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
    return undefined;
  }, [open]);

  useEffect(() => {
    if (open || !isRendered) return;

    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current);
    }
    const timer = window.setTimeout(() => {
      setIsRendered(false);
      unmountTimerRef.current = null;
    }, transitionDuration);
    unmountTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (unmountTimerRef.current === timer) {
        unmountTimerRef.current = null;
      }
    };
  }, [isRendered, open, transitionDuration]);

  useEffect(
    () => () => {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
      }
    },
    [],
  );

  const blurSearchWhenScrolling = () => {
    searchInputRef.current?.blur();
  };

  const blurSearchWhenLeavingField = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!searchInputRef.current?.contains(event.target as Node)) {
      blurSearchWhenScrolling();
    }
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;

    event.stopPropagation();
    const focusableElements = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.closest("[inert], [aria-hidden='true']")
      );
    });
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    if (!firstElement || !lastElement) return;
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (!isRendered) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-labelledby="bank-picker-dialog-title"
      aria-describedby="bank-picker-dialog-description"
      inert={open ? undefined : true}
      onKeyDown={handleDialogKeyDown}
      className={`fixed inset-0 z-[60] flex justify-end ${
        open ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <div
        style={getSlideBackdropStyle(transitionDuration)}
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity motion-reduce:transition-none ${
          isVisible
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onPointerDown={(event) => {
          backdropPointerDownRef.current = event.target === event.currentTarget;
        }}
        onPointerUp={(event) => {
          if (
            backdropPointerDownRef.current &&
            event.target === event.currentTarget
          ) {
            onClose();
          }
          backdropPointerDownRef.current = false;
        }}
        onPointerCancel={() => {
          backdropPointerDownRef.current = false;
        }}
      />
      <div
        ref={panelRef}
        style={getSlidePanelStyle(transitionDuration)}
        className={`relative z-10 flex h-full w-full max-w-[720px] flex-col overflow-hidden bg-white shadow-2xl transition-transform motion-reduce:transition-none ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <FormDialogHeader
          title={scope === "pay2s" ? "Chọn ngân hàng Pay2S" : "Chọn ngân hàng"}
          subtitle={
            scope === "pay2s"
              ? "Chỉ hiển thị ngân hàng Pay2S đang hỗ trợ nhận thanh toán."
              : "Tìm theo tên ngân hàng rồi chọn một kết quả."
          }
          titleId="bank-picker-dialog-title"
          descriptionId="bank-picker-dialog-description"
          onClose={onClose}
        />
        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4 sm:px-5"
          onPointerDownCapture={blurSearchWhenLeavingField}
          onWheelCapture={(event) => {
            if (!searchInputRef.current?.contains(event.target as Node)) {
              blurSearchWhenScrolling();
            }
          }}
        >
        <label className="form-label-text shrink-0 text-gray-700">
          Tìm ngân hàng
          <span className="relative mt-1.5 block">
            <RiSearchLine
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ví dụ: Vietcombank"
              aria-label="Tìm kiếm ngân hàng"
              autoComplete="off"
              className={cn(formTextControlClassName, "pl-9 pr-3")}
            />
          </span>
        </label>
        <div
          className="flex shrink-0 items-center justify-between gap-3 text-xs text-gray-500"
          aria-live="polite"
        >
          <span>{banks.length} kết quả</span>
          <span>
            {scope === "pay2s" ? "Danh mục Pay2S" : "Danh mục ngân hàng"}
          </span>
        </div>
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {banks.length > 0 ? (
            <div
              role="listbox"
              aria-label="Danh sách ngân hàng"
              className="grid gap-2 pb-1 sm:grid-cols-2"
            >
              {banks.map((bank) => {
                const isSelected = selectedBank?.code === bank.code;
                return (
                  <Button
                    key={bank.code}
                    type="button"
                    variant="ghost"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(bank)}
                    className={cn(
                      "h-auto min-h-14 w-full justify-start rounded-lg border px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-primary bg-primary-soft/50 text-gray-950"
                        : "border-gray-200 bg-white hover:border-primary/40 hover:bg-gray-50",
                    )}
                  >
                    <span className="inline-flex h-9 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-100 bg-white p-1.5">
                      {bank.logo ? (
                        <Image
                          src={bank.logo}
                          alt=""
                          width={72}
                          height={36}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <RiBankCardLine
                          className="h-5 w-5 text-gray-500"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {bank.shortName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-normal text-gray-500">
                        {bank.name}
                      </span>
                    </span>
                    {isSelected ? (
                      <RiCheckLine
                        className="h-4 w-4 shrink-0 text-primary"
                        aria-label="Đã chọn"
                      />
                    ) : null}
                  </Button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-600">
              Không tìm thấy ngân hàng phù hợp. Hãy thử tên đầy đủ hoặc tên viết
              tắt.
            </div>
          )}
        </div>
        {scope === "pay2s" ? (
          <p className="shrink-0 pt-2 text-xs leading-5 text-gray-500">
            Ngân hàng ngoài danh sách chưa hỗ trợ Pay2S; hãy dùng tài khoản thủ
            công.
          </p>
        ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GuideStep({
  number,
  title,
  purpose,
  items,
  result,
  href,
  label,
  icon,
}: {
  number: string;
  title: string;
  purpose: string;
  items: string[];
  result: string;
  href?: string;
  label?: string;
  icon: ReactNode;
}) {
  return (
    <article className="flex h-full min-h-[272px] flex-col rounded-xl border border-primary/15 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          {number}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            {icon}
            <span>Bước {number}</span>
          </div>
          <h3 className="mt-1 text-base font-bold leading-6 text-gray-950">
            {title}
          </h3>
        </div>
      </div>
      <p className="mt-4 text-sm font-medium leading-6 text-gray-800">
        {purpose}
      </p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-700">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <RiCheckLine
              className="mt-1 h-4 w-4 shrink-0 text-emerald-700"
              aria-hidden="true"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        <p className="rounded-lg bg-primary-soft/55 px-3 py-2.5 text-sm leading-5 text-primary">
          <strong>Hoàn tất khi:</strong> {result}
        </p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            {label ?? "Mở tài liệu"}
            <RiExternalLinkLine aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </article>
  );
}
