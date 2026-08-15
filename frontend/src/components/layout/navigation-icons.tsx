import type { IconType } from "react-icons";
import {
  RiBarChartBoxLine,
  RiDashboardLine,
  RiFileList3Line,
  RiGraduationCapLine,
  RiIdCardLine,
  RiLogoutBoxRLine,
  RiSettings3Line,
  RiTeamLine,
} from "react-icons/ri";

export type NavigationItem = {
  href: string;
  label: string;
  icon: IconType;
  opticalSize?: number;
};

export const MAIN_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: "/", label: "Tổng quan", icon: RiDashboardLine },
  { href: "/students", label: "Học viên", icon: RiTeamLine },
  { href: "/classes", label: "Lớp học", icon: RiGraduationCapLine },
  {
    href: "/staff",
    label: "Nhân sự",
    icon: RiIdCardLine,
    opticalSize: 19,
  },
  { href: "/fees", label: "Học phí", icon: RiFileList3Line },
  { href: "/report", label: "Báo cáo", icon: RiBarChartBoxLine },
];

export const SETTINGS_NAVIGATION_ITEM: NavigationItem = {
  href: "/settings",
  label: "Cài đặt",
  icon: RiSettings3Line,
};

export const LOGOUT_NAVIGATION_ICON = RiLogoutBoxRLine;

type NavigationIconProps = {
  icon: IconType;
  className?: string;
  opticalSize?: number;
};

/**
 * Keeps every navigation glyph on the same Remix Icon line family and optical size.
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
      className={`icon-system shrink-0 ${className ?? ""}`}
    />
  );
}
