"""Explicit Route Policy Registry (R7-D03 / R7-D14).

Ensures every endpoint in the FastAPI application has an explicit, tested
security classification:
- PUBLIC: Unauthenticated / health checks / initial login / password reset.
- AUTHENTICATED_SELF: Requires valid session, scoped strictly to the current user (e.g. /auth/me, /attendance/me/*).
- MANAGEMENT: Admin and Dev have identical management capabilities (e.g. /classes/*, /students/*, /fees/*, /staff/*, /reports/*).
- DEV_ONLY: Restricted strictly to the Dev account (e.g. user role & status management, invitations).
"""

from typing import Literal

RoutePolicyKind = Literal["PUBLIC", "AUTHENTICATED_SELF", "MANAGEMENT", "DEV_ONLY"]

# Registry of route path prefixes and exact paths to their required security policy
ROUTE_POLICIES: dict[str, RoutePolicyKind] = {
    # Public & Health
    "/": "PUBLIC",
    "/health/live": "PUBLIC",
    "/health/ready": "PUBLIC",
    "/docs": "PUBLIC",
    "/docs/oauth2-redirect": "PUBLIC",
    "/redoc": "PUBLIC",
    "/openapi.json": "PUBLIC",
    "/auth/login": "PUBLIC",
    "/auth/login/totp/verify": "PUBLIC",
    "/auth/login/recovery/verify": "PUBLIC",
    "/auth/refresh": "PUBLIC",
    "/auth/logout": "PUBLIC",
    "/auth/register": "PUBLIC",
    "/auth/password/reset/start": "PUBLIC",
    "/auth/password/reset/verify-otp": "PUBLIC",
    "/auth/password/reset/complete": "PUBLIC",
    "/auth/google/onboarding/start": "PUBLIC",
    "/auth/google/onboarding/callback": "PUBLIC",
    "/auth/onboarding/totp/enroll": "PUBLIC",
    "/auth/onboarding/totp/verify": "PUBLIC",
    "/auth/google/avatar/proxy": "PUBLIC",
    # Self-Auth & Self-Attendance
    "/auth/me": "AUTHENTICATED_SELF",
    "/auth/me/username": "AUTHENTICATED_SELF",
    "/auth/me/avatar/sync": "AUTHENTICATED_SELF",
    "/auth/me/password/verify": "AUTHENTICATED_SELF",
    "/attendance/me/today": "AUTHENTICATED_SELF",
    "/attendance/me/occurrences/{occurrence_id}/check-in": "AUTHENTICATED_SELF",
    # Dev-Only Account Administration
    "/auth/users": "DEV_ONLY",
    "/auth/users/{user_id}/role": "DEV_ONLY",
    "/auth/users/{user_id}/status": "DEV_ONLY",
    "/auth/invitations": "DEV_ONLY",
    "/auth/invitations/{invitation_id}": "DEV_ONLY",
}

# Domain prefix fallback policies for all management routers
DOMAIN_PREFIX_POLICIES: dict[str, RoutePolicyKind] = {
    "/classes": "MANAGEMENT",
    "/class-session-exceptions": "MANAGEMENT",
    "/students": "MANAGEMENT",
    "/enrollments": "MANAGEMENT",
    "/fees": "MANAGEMENT",
    "/reports": "MANAGEMENT",
    "/staff": "MANAGEMENT",
    "/dashboard": "MANAGEMENT",
    "/contact-suggestions": "MANAGEMENT",
}


def get_route_policy(path: str) -> RoutePolicyKind:
    """Resolve the explicit security policy for an API endpoint path."""
    if path in ROUTE_POLICIES:
        return ROUTE_POLICIES[path]
    for prefix, policy in DOMAIN_PREFIX_POLICIES.items():
        if path == prefix or path.startswith(f"{prefix}/"):
            return policy
    raise ValueError(
        f"Route '{path}' does not have an explicit security policy registered."
    )
