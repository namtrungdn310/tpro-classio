import { apiClient } from "@/lib/api/client";
import {
  bankingOverviewSchema,
  bankAccountListSchema,
  pay2sProviderStatusSchema,
  pay2sSupportedBanksSchema,
} from "@/lib/schemas/banking";
import type {
  BankAccount,
  BankAccountCreate,
  BankAccountUpdate,
  BankingOverview,
  Pay2SConnectionInput,
  Pay2SProviderStatus,
  Pay2SBankConnectInput,
  Pay2SBankOtpInput,
  Pay2SBankConnectResponse,
  Pay2SWebhookResponse,
  Pay2SSupportedBanks,
} from "@/lib/types";

export async function getBankingOverview(): Promise<BankingOverview> {
  const { data } = await apiClient.get<unknown>("/banking/overview");
  return bankingOverviewSchema.parse(data) as BankingOverview;
}

export async function getBankAccounts(): Promise<{ accounts: BankAccount[] }> {
  const { data } = await apiClient.get<unknown>("/banking/accounts");
  return bankAccountListSchema.parse(data) as { accounts: BankAccount[] };
}

export async function createBankAccount(
  payload: BankAccountCreate,
): Promise<BankAccount> {
  const { data } = await apiClient.post<unknown>("/banking/accounts", payload);
  return bankingOverviewSchema.shape.accounts.element.parse(
    data,
  ) as BankAccount;
}

export async function createManualBankAccount(
  payload: BankAccountCreate,
  qrImage: File | null,
): Promise<BankAccount> {
  const formData = new FormData();
  formData.set(
    "payload_json",
    JSON.stringify({ ...payload, qr_source_url: null }),
  );
  if (qrImage) {
    formData.set("qr_image", qrImage, qrImage.name);
  }
  const { data } = await apiClient.post<unknown>(
    "/banking/accounts/manual",
    formData,
  );
  return bankingOverviewSchema.shape.accounts.element.parse(
    data,
  ) as BankAccount;
}

export async function updateBankAccount(
  id: string,
  payload: BankAccountUpdate,
): Promise<BankAccount> {
  const { data } = await apiClient.patch<unknown>(
    `/banking/accounts/${id}`,
    payload,
  );
  return bankingOverviewSchema.shape.accounts.element.parse(
    data,
  ) as BankAccount;
}

export async function archiveBankAccount(id: string): Promise<void> {
  await apiClient.delete(`/banking/accounts/${id}`);
}

export async function savePay2SConnection(
  payload: Pay2SConnectionInput,
): Promise<Pay2SProviderStatus> {
  const { data } = await apiClient.put<unknown>(
    "/banking/providers/pay2s",
    payload,
  );
  return pay2sProviderStatusSchema.parse(data) as Pay2SProviderStatus;
}

export async function verifyPay2SConnection(): Promise<Pay2SProviderStatus> {
  const { data } = await apiClient.post<unknown>(
    "/banking/providers/pay2s/verify",
  );
  return pay2sProviderStatusSchema.parse(data) as Pay2SProviderStatus;
}

export async function getPay2SSupportedBanks(): Promise<Pay2SSupportedBanks> {
  const { data } = await apiClient.get<unknown>(
    "/banking/providers/pay2s/supported-banks",
  );
  return pay2sSupportedBanksSchema.parse(data) as Pay2SSupportedBanks;
}

const pay2sBankConnectSchema = bankingOverviewSchema.shape.accounts.element;

export async function connectPay2SBank(
  payload: Pay2SBankConnectInput,
): Promise<Pay2SBankConnectResponse> {
  const { data } = await apiClient.post<Pay2SBankConnectResponse>(
    "/banking/providers/pay2s/banks",
    payload,
  );
  const result = data as Pay2SBankConnectResponse;
  if (result.account) pay2sBankConnectSchema.parse(result.account);
  return result;
}

export async function confirmPay2SBankOtp(
  payload: Pay2SBankOtpInput,
): Promise<Pay2SBankConnectResponse> {
  const { data } = await apiClient.post<Pay2SBankConnectResponse>(
    "/banking/providers/pay2s/banks/confirm-otp",
    payload,
  );
  return data as Pay2SBankConnectResponse;
}

export async function createPay2SWebhook(
  accountId: string,
): Promise<Pay2SWebhookResponse> {
  const { data } = await apiClient.post<Pay2SWebhookResponse>(
    `/banking/providers/pay2s/accounts/${accountId}/webhook`,
  );
  return data;
}
