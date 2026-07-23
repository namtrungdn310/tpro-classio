import { AuthLogoButton } from "@/components/layout/auth-logo-button";

export function AuthBrand() {
  return (
    <div className="auth-brand" aria-label="TPRO English Classio">
      <div className="auth-brand-mark">
        <AuthLogoButton className="h-9 w-9" size={36} />
      </div>
      <div className="min-w-0">
        <p className="auth-brand-name">TPRO ENGLISH</p>
        <p className="auth-brand-product">Classio · Quản lý trung tâm</p>
      </div>
    </div>
  );
}
