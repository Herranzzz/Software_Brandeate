#!/usr/bin/env python3
"""
Elimina pedidos y expediciones con más de N meses de antigüedad de la base de datos.

Uso:
    DATABASE_URL=postgresql+psycopg://... python scripts/cleanup-old-orders.py
    python scripts/cleanup-old-orders.py --months 3 --dry-run

Argumentos opcionales:
    --months N    Meses de antigüedad (por defecto 3)
    --dry-run     Solo cuenta, no elimina
"""
import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

try:
    import psycopg
    _DRIVER = "psycopg"
except ImportError:
    try:
        import psycopg2 as psycopg
        _DRIVER = "psycopg2"
    except ImportError:
        print("ERROR: instala psycopg o psycopg2  →  pip install psycopg[binary]")
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Limpia pedidos antiguos de la BD")
    parser.add_argument("--months", type=int, default=3, help="Meses de antigüedad (default: 3)")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra la cuenta, sin borrar")
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: Define DATABASE_URL como variable de entorno")
        sys.exit(1)

    # psycopg (v3) usa postgresql+psycopg://... pero el driver nativo usa postgresql://
    conn_str = db_url.replace("postgresql+psycopg://", "postgresql://")

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.months * 30)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S+00")

    print(f"Cutoff: pedidos creados antes del {cutoff_str}")
    print(f"Modo: {'DRY-RUN (sin cambios)' if args.dry_run else 'ELIMINAR'}")
    print()

    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            # Cuenta antes
            cur.execute("SELECT COUNT(*) FROM orders")
            total_before = cur.fetchone()[0]

            cur.execute(
                "SELECT COUNT(*) FROM orders WHERE created_at < %s",
                (cutoff,),
            )
            to_delete = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM shipments")
            shipments_before = cur.fetchone()[0]

            print(f"Pedidos totales:          {total_before}")
            print(f"Pedidos a eliminar:       {to_delete}")
            print(f"Pedidos que quedan:       {total_before - to_delete}")
            print(f"Expediciones totales:     {shipments_before}")
            print()

            if args.dry_run:
                print("DRY-RUN: no se realizaron cambios.")
                return

            if to_delete == 0:
                print("No hay pedidos que limpiar.")
                return

            confirm = input(f"¿Confirmas eliminar {to_delete} pedidos? [s/N]: ").strip().lower()
            if confirm not in ("s", "si", "sí", "y", "yes"):
                print("Cancelado.")
                return

            # Borra (las foreign keys en cascada eliminan shipments, items, incidents, etc.)
            cur.execute(
                "DELETE FROM orders WHERE created_at < %s",
                (cutoff,),
            )
            deleted = cur.rowcount
            conn.commit()

            cur.execute("SELECT COUNT(*) FROM orders")
            total_after = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM shipments")
            shipments_after = cur.fetchone()[0]

            print(f"✅ Eliminados: {deleted} pedidos")
            print(f"   Pedidos restantes:  {total_after}")
            print(f"   Expediciones:       {shipments_after} (antes: {shipments_before})")


if __name__ == "__main__":
    main()
