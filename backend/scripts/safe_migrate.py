from __future__ import annotations

import os
import subprocess
import sys

from sqlalchemy import create_engine, inspect, text


TARGET_REVISION = "0027_employee_traceability"


def run_alembic(*args: str) -> None:
    subprocess.run(["alembic", *args], check=True)


def schema_matches_employee_traceability() -> bool:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return False

    engine = create_engine(database_url)
    with engine.connect() as connection:
        inspector = inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("shipments")}
        indexes = {index["name"] for index in inspector.get_indexes("shipments")}
        foreign_keys = {foreign_key["name"] for foreign_key in inspector.get_foreign_keys("shipments")}
        version = connection.execute(text("select version_num from alembic_version")).scalar_one_or_none()

    return (
        version == "0026_returns"
        and "created_by_employee_id" in columns
        and "ix_shipments_created_by_employee_id" in indexes
        and "fk_shipments_created_by_employee_id_users" in foreign_keys
    )


def main() -> int:
    try:
        run_alembic("upgrade", "head")
        return 0
    except subprocess.CalledProcessError as exc:
        print(f"Primary migration failed with exit code {exc.returncode}.", file=sys.stderr)
        if not schema_matches_employee_traceability():
            return exc.returncode

        print("Detected schema already aligned with employee traceability migration. Stamping revision and retrying...", file=sys.stderr)
        run_alembic("stamp", TARGET_REVISION)
        run_alembic("upgrade", "head")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
