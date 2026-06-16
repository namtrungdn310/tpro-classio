import axios from "axios";

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

apiClient.interceptors.request.use((config) => {
  if (typeof window === "undefined") {
    return config;
  }

  const token = window.localStorage.getItem("tpro_access_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error.response?.status === 401) {
      window.localStorage.removeItem("tpro_access_token");
      window.localStorage.removeItem("tpro_user_email");
      window.location.href = "/login";
    }

    return Promise.reject(error);
  },
);
