"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "warning" | "info";

type ToastOptions = {
  duration?: number;
  title?: string;
};

type ToastItem = ToastOptions & {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastApi = {
  dismiss: (id: number) => void;
  error: (message: string, options?: ToastOptions) => number;
  info: (message: string, options?: ToastOptions) => number;
  success: (message: string, options?: ToastOptions) => number;
  warning: (message: string, options?: ToastOptions) => number;
};

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_TOAST_DURATION = 3500;

const variantConfig = {
  success: {
    defaultDuration: DEFAULT_TOAST_DURATION,
    defaultTitle: "Thành công",
    accent: "bg-emerald-500",
    icon: "bg-emerald-50 text-emerald-700",
    Icon: CheckCircle2,
  },
  error: {
    defaultDuration: DEFAULT_TOAST_DURATION,
    defaultTitle: "Không thể hoàn tất",
    accent: "bg-red-500",
    icon: "bg-red-50 text-red-700",
    Icon: CircleAlert,
  },
  warning: {
    defaultDuration: DEFAULT_TOAST_DURATION,
    defaultTitle: "Cần lưu ý",
    accent: "bg-amber-500",
    icon: "bg-amber-50 text-amber-700",
    Icon: TriangleAlert,
  },
  info: {
    defaultDuration: DEFAULT_TOAST_DURATION,
    defaultTitle: "Thông tin",
    accent: "bg-blue-500",
    icon: "bg-blue-50 text-blue-700",
    Icon: Info,
  },
} satisfies Record<ToastVariant, object>;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timeoutId = timersRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (variant: ToastVariant, message: string, options: ToastOptions = {}) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      const config = variantConfig[variant];
      const duration = options.duration ?? config.defaultDuration;

      setToasts((current) => [
        { id, message, variant, title: options.title, duration },
        ...current,
      ].slice(0, MAX_VISIBLE_TOASTS));

      if (duration > 0) {
        const timeoutId = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timeoutId);
      }

      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timersRef.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      dismiss,
      error: (message, options) => show("error", message, options),
      info: (message, options) => show("info", message, options),
      success: (message, options) => show("success", message, options),
      warning: (message, options) => show("warning", message, options),
    }),
    [dismiss, show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-label="Thông báo hệ thống"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(calc(100vw-2rem),360px)] flex-col-reverse gap-2.5 sm:bottom-5 sm:right-5"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}

function ToastCard({
  onDismiss,
  toast,
}: {
  onDismiss: (id: number) => void;
  toast: ToastItem;
}) {
  const config = variantConfig[toast.variant];
  const Icon = config.Icon;

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      aria-atomic="true"
      className="app-toast pointer-events-auto relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${config.accent}`} aria-hidden="true" />
      <div className="flex items-start gap-3 py-3 pl-4 pr-3">
        <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.icon}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-ui text-[13px] font-semibold leading-5 text-gray-950">
            {toast.title ?? config.defaultTitle}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-gray-600">{toast.message}</p>
        </div>
        <button
          type="button"
          aria-label="Đóng thông báo"
          onClick={() => onDismiss(toast.id)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {toast.duration && toast.duration > 0 ? (
        <span
          className={`app-toast-progress absolute bottom-0 left-0 h-1 w-full ${config.accent}`}
          style={{ animationDuration: `${toast.duration}ms` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
