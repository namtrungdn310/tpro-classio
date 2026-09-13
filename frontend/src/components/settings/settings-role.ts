export type SettingsRoleKey = "dev" | "admin" | "teacher" | "unknown";

type RoleSource = {
  is_owner: boolean;
  role: string;
};

const ROLE_PRESENTATIONS = {
  dev: "Dev",
  admin: "Admin",
  teacher: "Giáo viên",
  unknown: "Không xác định",
} satisfies Record<SettingsRoleKey, string>;

export function getSettingsRole(source: RoleSource): SettingsRoleKey {
  if (source.is_owner) return "dev";
  if (source.role === "admin") return "admin";
  if (source.role === "teacher") return "teacher";
  return "unknown";
}

export function getSettingsRoleLabel(source: RoleSource) {
  return ROLE_PRESENTATIONS[getSettingsRole(source)];
}
