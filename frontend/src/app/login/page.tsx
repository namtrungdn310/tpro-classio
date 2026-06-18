"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { login } from "@/lib/api/auth";

const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setError("");

    try {
      const data = await login(values.email, values.password);
      window.localStorage.setItem("tpro_token", data.access_token);
      router.push("/");
    } catch {
      setError("Email hoặc mật khẩu không đúng");
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
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register("email")}
              className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
            {errors.email ? <p className="text-sm text-red-600">{errors.email.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-gray-700">
              Mật khẩu
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
              className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-[#1F5C2E] focus:ring-2 focus:ring-[#1F5C2E]/15"
            />
            {errors.password ? (
              <p className="text-sm text-red-600">{errors.password.message}</p>
            ) : null}
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
