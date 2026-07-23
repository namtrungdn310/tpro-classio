export type SettingsRoleKey = "dev" | "admin" | "viewer";

type RoleSource = {
  is_owner: boolean;
  role: string;
};

const ROLE_PRESENTATIONS = {
  dev: "Dev",
  admin: "Admin",
  viewer: "Viewer",
} satisfies Record<SettingsRoleKey, string>;

export function getSettingsRole(source: RoleSource): SettingsRoleKey {
  if (source.is_owner) return "dev";
  return source.role === "admin" ? "admin" : "viewer";
}

export function getSettingsRoleLabel(source: RoleSource) {
  return ROLE_PRESENTATIONS[getSettingsRole(source)];
}
