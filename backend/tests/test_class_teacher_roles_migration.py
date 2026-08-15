from pathlib import Path


def _read_migration() -> str:
    return (
        Path(__file__).parents[1]
        / "supabase"
        / "migrations"
        / "049_class_teacher_roles.sql"
    ).read_text(encoding="utf-8")


def test_class_teacher_roles_migration_accepts_teachers_and_assistants() -> None:
    migration = _read_migration()

    assert (
        "create or replace function public.validate_class_teacher_staff()" in migration
    )
    assert "teacher_type not in ('TEACHER', 'ASSISTANT')" in migration
    assert "class member must be a teacher or assistant" in migration
    assert "active class member must be active" in migration


def test_class_teacher_roles_migration_recreates_junction_trigger() -> None:
    migration = _read_migration()

    assert "drop trigger if exists class_teachers_validate_staff" in migration
    assert "create trigger class_teachers_validate_staff" in migration
    assert "before insert or update of class_id, teacher_id" in migration


def test_class_teacher_roles_migration_does_not_touch_legacy_column_guard() -> None:
    migration = _read_migration()
    # Bỏ comment SQL trước khi assert để không phụ thuộc chữ trong chú thích.
    without_comments = "\n".join(
        line for line in migration.splitlines() if not line.lstrip().startswith("--")
    )

    assert "validate_legacy_class_teacher_staff" not in without_comments
    assert "classes.teacher_id" not in without_comments


def _read_legacy_guard_migration() -> str:
    return (
        Path(__file__).parents[1]
        / "supabase"
        / "migrations"
        / "050_class_teacher_roles_legacy_guard.sql"
    ).read_text(encoding="utf-8")


def test_legacy_guard_keeps_teacher_id_teacher_only() -> None:
    migration = _read_legacy_guard_migration()

    assert (
        "create or replace function public.validate_legacy_class_teacher_staff()"
        in migration
    )
    assert "classes.teacher_id must reference a teacher" in migration


def test_legacy_guard_allows_active_teachers_and_assistants_in_junction() -> None:
    migration = _read_legacy_guard_migration()

    assert "and not staff.is_active" in migration
    assert "active class contains an inactive teacher or assistant" in migration
    assert "staff.staff_type <> 'TEACHER'" not in migration
