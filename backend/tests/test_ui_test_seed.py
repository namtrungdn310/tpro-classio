from pathlib import Path


SEED_SOURCE = (
    Path(__file__).resolve().parents[1] / "scripts" / "seed_ui_test_data.py"
).read_text(encoding="utf-8")


def test_ui_seed_is_workspace_scoped_and_idempotent() -> None:
    assert 'f"{_fixture_workspace_id}:{kind}:{key}"' in SEED_SOURCE
    assert "on conflict (id) do nothing" in SEED_SOURCE
    assert "async def add_once" in SEED_SOURCE


def test_ui_seed_fails_closed_in_production() -> None:
    assert 'settings.app_environment == "production"' in SEED_SOURCE
    assert "Refusing to seed UI test data in production" in SEED_SOURCE


def test_ui_seed_uses_open_ended_structured_classes() -> None:
    assert 'identity_scheme="ACADEMIC_YEAR"' in SEED_SOURCE
    assert "effective_until=(completed.date() if completed else None)" in SEED_SOURCE
    assert "stopped_reason=(" in SEED_SOURCE
    assert 'identity_scheme="LEGACY"' not in SEED_SOURCE


def test_ui_seed_supports_reproducible_business_dates_and_dry_runs() -> None:
    assert '"--as-of-date"' in SEED_SOURCE
    assert "today = args.as_of_date or date.today()" in SEED_SOURCE
    assert "await db.rollback()" in SEED_SOURCE


def test_ui_seed_models_a_multi_year_centre_instead_of_flat_cards() -> None:
    assert "for years_ago in (1, 2, 3)" in SEED_SOURCE
    assert "Twelve recent monthly periods" in SEED_SOURCE
    assert "roster_names = [" in SEED_SOURCE
    assert 'f"history-{today.year - years_ago}-{cohort}"' in SEED_SOURCE


def test_ui_seed_populates_the_application_views_not_only_base_tables() -> None:
    assert "get_effective_occurrences_for_range" in SEED_SOURCE
    assert "get_dashboard_overview" in SEED_SOURCE
    assert "get_paid_fee_receipts" in SEED_SOURCE
    assert "async def add_payment_receipt" in SEED_SOURCE
    assert '"fee_operations": 0' in SEED_SOURCE
    assert '"paid_report_receipts": 12' in SEED_SOURCE


def test_clean_workspace_rotation_is_explicit_and_production_safe() -> None:
    source = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "prepare_clean_demo_workspace.py"
    ).read_text(encoding="utf-8")
    assert 'CONFIRMATION = "REPLACE_DEMO_WORKSPACE"' in source
    assert 'settings.app_environment == "production"' in source
    assert "owner_user_id=null" in source
    assert "update public.profiles set workspace_id=:workspace_id" in source
