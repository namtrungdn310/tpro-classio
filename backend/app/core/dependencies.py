"""R6-D14: deny-by-default dependencies.

`get_current_user`/`require_admin`/`require_owner` are thin re-exports of the
typed principal resolution (see `app.core.principal`). Effective roles are
`dev|admin|teacher`; `viewer` runtime is retired; teacher self-route policy
lives in `require_teacher_self`.
"""

from app.core.principal import (
    Principal,
    get_current_user,
    require_admin,
    require_dev,
    require_management,
    require_owner,
    require_teacher_self,
    resolve_principal,
)

__all__ = [
    "Principal",
    "get_current_user",
    "require_admin",
    "require_dev",
    "require_management",
    "require_owner",
    "require_teacher_self",
    "resolve_principal",
]
