"use client";

import Image from "next/image";

interface AuthLogoButtonProps {
  className?: string;
  size?: number;
}

export function AuthLogoButton({ className = "mb-4 h-[42px] w-[42px]", size = 42 }: AuthLogoButtonProps) {
  return (
    <button
      type="button"
      aria-label="Tải lại trang"
      title="Tải lại trang"
      onClick={() => window.location.reload()}
      className={`block appearance-none border-0 bg-transparent p-0 ${className}`}
    >
      <Image
        src="/logo-mark-bw.png"
        alt="TPRO"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority
      />
    </button>
  );
}
