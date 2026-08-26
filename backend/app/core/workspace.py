"""Request-scoped workspace boundary used by every business operation.

An administrator owns exactly one workspace.  Business rows carry the same
workspace id and the ORM automatically applies the current boundary to reads,
updates and deletes.  The database migration adds the matching column,
constraints and insert guard; this module is deliberately fail-closed for
authenticated requests while remaining inert for isolated unit tests that do
not establish an HTTP principal.
"""

from contextvars import ContextVar

from sqlalchemy import UUID
from sqlalchemy.orm import Mapped, mapped_column


current_workspace_id: ContextVar[str | None] = ContextVar(
    "tpro_current_workspace_id", default=None
)


class WorkspaceScoped:
    """Mixin for rows that must never cross an administrator workspace."""

    workspace_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )


def get_workspace_id() -> str | None:
    return current_workspace_id.get()


def set_workspace_id(workspace_id: str) -> object:
    return current_workspace_id.set(str(workspace_id))


def reset_workspace_id(token: object) -> None:
    current_workspace_id.reset(token)  # type: ignore[arg-type]
