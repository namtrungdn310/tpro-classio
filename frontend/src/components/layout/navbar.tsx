"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";

export function Navbar() {
  const router = useRouter();
  const { logout, user } = useAuth();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Image
          src="/logo-mark-bw.png"
          alt="TPRO"
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
          priority
        />
        TPRO Classio
      </Link>
      <div className="flex items-center gap-3 text-sm text-gray-700">
        <span className="hidden sm:inline">{user?.email}</span>
        <button
          type="button"
          onClick={handleLogout}
          className="min-h-10 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
