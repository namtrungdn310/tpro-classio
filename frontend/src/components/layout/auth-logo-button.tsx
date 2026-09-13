"use client";

import Image from "next/image";

interface AuthLogoButtonProps {
  className?: string;
  size?: number;
}

export function AuthLogoButton({ className = "mb-4 h-[52px] w-[52px]", size = 52 }: AuthLogoButtonProps) {
  return (
    <button
      type="button"
      aria-label="Tải lại trang"
      title="Tải lại trang"
      onClick={() => window.location.reload()}
      className={`block appearance-none border-0 bg-transparent p-0 ${className}`}
    >
      <Image
        src="/logo-mark.png"
        alt="TPRO"
        width={size * 3}
        height={size * 3}
        quality={100}
        className="h-full w-full object-contain"
        priority
      />
    </button>
  );
}
