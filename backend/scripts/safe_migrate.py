from __future__ import annotations

import os
import subprocess
import sys

from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings

# ── Legacy recovery: DB was stamped here before the migration chain was
# properly committed; we stamp → upgrade if we detect this case.
LEGACY_STAMP_TARGET = "0027_employee_traceability"

# ── Known good revision that is always findable by Alembic. Used as a
# recovery point when alembic_version contains a revision that can no longer
# be resolved (e.g. after a botched merge-revision renaming).
MERGE_HEAD = "0047_merge_heads"

# ── All revisions known to exist in the current codebase. If alembic_version
# holds something NOT in this set Alembic will fail with "Can't locate
# revision". We detect that and stamp to MERGE_HEAD so the missing tail
# migrations can be re-applied cleanly.
KNOWN_REVISIONS = {
    "0047_merge_heads",
    "0048",
    "0049",
}


def run_alembic(*args: str) -> None:
    subprocess.run(["alembic", *args], check=True)


def _get_db_engine():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return None
    try:
        return create_engine(get_settings().database_url)
    except Exception:
        return None


def get_current_versions() -> list[str]:
    """Return all rows in alembic_version (can be >1 with multi-head branches)."""
    engine = _get_db_engine()
    if engine is None:
        return []
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("select version_num from alembic_version")).fetchall()
            return [r[0] for r in rows if r[0]]
    except Exception:
        return []


def schema_matches_employee_traceability() -> bool:
    """Legacy check: DB is at the old pre-chain stamp point."""
    engine = _get_db_engine()
    if engine is None:
        return False
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            columns = {c["name"] for c in inspector.get_columns("shipments")}
            indexes = {i["name"] for i in inspector.get_indexes("shipments")}
            foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("shipments")}
            rows = connection.execute(text("select version_num from alembic_version")).fetchall()
            versions = [r[0] for r in rows]
    except Exception:
        return False

    return (
        len(versions) == 1
        and versions[0] == "0026_returns"
        and "created_by_employee_id" in columns
        and "ix_shipments_created_by_employee_id" in indexes
        and "fk_shipments_created_by_employee_id_users" in foreign_keys
    )


def has_unresolvable_revision() -> bool:
    """Return True if alembic_version contains a revision Alembic can't locate."""
    versions = get_current_versions()
    return bool(versions) and any(v not in KNOWN_REVISIONS for v in versions)


def main() -> int:
    # ── Attempt 1: normal upgrade ───────────────────────────────────────────
    try:
        run_alembic("upgrade", "head")
        return 0
    except subprocess.CalledProcessError as exc:
        print(f"Primary migration failed with exit code {exc.returncode}.", file=sys.stderr)

    # ── Recovery A: DB has an unresolvable revision from a renamed merge ───
    if has_unresolvable_revision():
        versions = get_current_versions()
        print(
            f"Detected unresolvable revision(s) {versions} in alembic_version. "
            f"Stamping to {MERGE_HEAD} and retrying...",
            file=sys.stderr,
        )
        try:
            run_alembic("stamp", "--purge", MERGE_HEAD)
            run_alembic("upgrade", "head")
            return 0
        except subprocess.CalledProcessError as exc2:
            print(f"Recovery A failed with exit code {exc2.returncode}.", file=sys.stderr)
            return exc2.returncode

    # ── Recovery B: legacy pre-chain stamp ─────────────────────────────────
    if schema_matches_employee_traceability():
        print(
            "Detected schema already aligned with employee traceability migration. "
            f"Stamping revision to {LEGACY_STAMP_TARGET} and retrying...",
            file=sys.stderr,
        )
        try:
            run_alembic("stamp", LEGACY_STAMP_TARGET)
            run_alembic("upgrade", "head")
            return 0
        except subprocess.CalledProcessError as exc3:
            print(f"Recovery B failed with exit code {exc3.returncode}.", file=sys.stderr)
            return exc3.returncode

    # ── No recovery path matched — propagate original failure ──────────────
    print("No recovery path matched. Deploy failed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
