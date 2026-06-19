import axios from "axios";

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = window.localStorage.getItem("tpro_refresh_token");
  if (!refreshToken) {
    throw new Error("Missing refresh token");
  }

  const { data } = await axios.post<{
    access_token: string;
    refresh_token: string;
  }>(
    `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
    { refresh_token: refreshToken },
  );

  window.localStorage.setItem("tpro_token", data.access_token);
  window.localStorage.setItem("tpro_refresh_token", data.refresh_token);
  return data.access_token;
}

apiClient.interceptors.request.use((config) => {
  if (typeof window === "undefined") {
    return config;
  }

  const token = window.localStorage.getItem("tpro_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      typeof window !== "undefined" &&
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/login") &&
      !originalRequest.url?.includes("/auth/refresh")
    ) {
      originalRequest._retry = true;

      try {
        refreshPromise = refreshPromise ?? refreshAccessToken();
        const token = await refreshPromise;
        refreshPromise = null;
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return apiClient(originalRequest);
      } catch {
        refreshPromise = null;
      }
    }

    if (typeof window !== "undefined" && error.response?.status === 401) {
      window.localStorage.removeItem("tpro_token");
      window.localStorage.removeItem("tpro_refresh_token");
      window.location.href = "/login";
    }

    return Promise.reject(error);
  },
);
