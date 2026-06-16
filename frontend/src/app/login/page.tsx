"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";

type LoginResponse = {
  access_token?: string;
  token?: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const { data } = await apiClient.post<LoginResponse>("/auth/login", {
        email,
        password,
      });
      const token = data.access_token ?? data.token;

      if (!token) {
        throw new Error("Missing token");
      }

      window.localStorage.setItem("tpro_access_token", token);
      window.localStorage.setItem("tpro_user_email", email);
      router.push("/");
    } catch {
      setError("Email hoặc mật khẩu không đúng");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <section className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <Image
            src="/logo-mark-bw.png"
            alt="TPRO"
            width={40}
            height={40}
            className="mb-3 h-10 w-10 object-contain"
            priority
          />
          <h1 className="text-lg font-medium text-gray-900">TPRO Classio</h1>
          <p className="mt-1 text-sm text-gray-500">Đăng nhập để tiếp tục</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-gray-700">
              Mật khẩu
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-10 w-full rounded-md bg-[#1F5C2E] px-4 text-sm font-medium text-white hover:bg-[#194a25] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Đang đăng nhập" : "Đăng nhập"}
          </button>
        </form>
      </section>
    </main>
  );
}
