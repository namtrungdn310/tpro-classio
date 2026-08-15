"""Route Security Policy Registry & RBAC Verification Tests (R7-D03 / R7-D14)."""

from starlette.routing import Route

from app.core.principal import Principal
from app.core.route_policy import get_route_policy
from app.main import app


def test_all_registered_routes_have_explicit_security_policy():
    """Verify that every single route in the FastAPI application has an explicit policy."""
    for route in app.routes:
        if isinstance(route, Route):
            path = route.path
            policy = get_route_policy(path)
            assert policy in (
                "PUBLIC",
                "AUTHENTICATED_SELF",
                "MANAGEMENT",
                "DEV_ONLY",
            ), f"Route {path} resolved to invalid policy {policy}"


def test_teacher_role_cannot_satisfy_management_policy():
    teacher = Principal(
        user_id="test-teacher-id",
        email="teacher@example.com",
        persistent_role="teacher",
        effective_role="teacher",
        is_owner=False,
        account_status="active",
        staff_id="test-staff-id",
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )
    assert not teacher.is_management
    assert not teacher.is_dev


def test_admin_and_dev_have_identical_management_access():
    admin = Principal(
        user_id="test-admin-id",
        email="admin@example.com",
        persistent_role="admin",
        effective_role="admin",
        is_owner=False,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )
    dev = Principal(
        user_id="test-dev-id",
        email="dev@example.com",
        persistent_role="admin",
        effective_role="dev",
        is_owner=True,
        account_status="active",
        staff_id=None,
        aal="aal2",
        device_type="desktop",
        session_nonce="test-nonce",
    )
    assert admin.is_management is True
    assert dev.is_management is True
    assert admin.is_dev is False
    assert dev.is_dev is True
