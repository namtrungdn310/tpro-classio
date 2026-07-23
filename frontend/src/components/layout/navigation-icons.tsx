import {
  ChartNoAxesColumnIncreasing,
  GraduationCap,
  IdCardLanyard,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  opticalSize?: number;
};

export const MAIN_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/students", label: "Học viên", icon: UsersRound },
  { href: "/classes", label: "Lớp học", icon: GraduationCap },
  {
    href: "/staff",
    label: "Nhân sự",
    icon: IdCardLanyard,
    opticalSize: 19,
  },
  { href: "/fees", label: "Học phí", icon: ReceiptText },
  { href: "/report", label: "Báo cáo", icon: ChartNoAxesColumnIncreasing },
];

export const SETTINGS_NAVIGATION_ITEM: NavigationItem = {
  href: "/settings",
  label: "Cài đặt",
  icon: Settings,
};

export const LOGOUT_NAVIGATION_ICON = LogOut;

type NavigationIconProps = {
  icon: LucideIcon;
  className?: string;
  opticalSize?: number;
};

/**
 * Keeps every navigation glyph on the same Lucide geometry and optical weight.
 * `absoluteStrokeWidth` prevents the visible stroke from changing when CSS scales
 * an icon in a different navigation layout.
 */
export function NavigationIcon({
  icon: Icon,
  className,
  opticalSize = 18,
}: NavigationIconProps) {
  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      size={opticalSize}
      strokeWidth={1.75}
      absoluteStrokeWidth
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ""}`}
    />
  );
}
