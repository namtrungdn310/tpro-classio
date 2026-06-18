import { apiClient } from "@/lib/api/client";

export type TokenResponse = {
  access_token: string;
  token_type: string;
  role: string;
};

export type UserMe = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
};

export async function login(email: string, password: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>("/auth/login", { email, password });
  return data;
}

export async function getMe(): Promise<UserMe> {
  const { data } = await apiClient.get<UserMe>("/auth/me");
  return data;
}

export function logout(): void {
  window.localStorage.removeItem("tpro_token");
}
