"""
Punto de entrada del worker de sincronización de Shopify.

Ejecuta el scheduler en un proceso separado, independiente del servidor web.
Esto permite escalar el worker de forma independiente y evitar que el sync
comparta recursos con las peticiones HTTP en producción.

Uso:
    python worker.py

Variables de entorno necesarias:
    DATABASE_URL          — conexión a la base de datos
    SHOPIFY_SYNC_ENABLED  — true/false (default: true)
    SHOPIFY_SYNC_INTERVAL_MINUTES — intervalo entre sincronizaciones (default: 5)
    SHOPIFY_SYNC_MAX_ORDERS — máximo de pedidos por sincronización (default: 5000)
"""
import logging
import signal
import sys

from app.core.config import get_settings
from app.services.shopify_scheduler import scheduler


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("worker")


def _handle_sigterm(signum, frame):
    logger.info("SIGTERM received, stopping scheduler...")
    scheduler.stop()
    sys.exit(0)


def main() -> None:
    settings = get_settings()

    if not settings.shopify_sync_enabled:
        logger.info("Shopify sync is disabled (SHOPIFY_SYNC_ENABLED=false). Exiting.")
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)

    logger.info(
        "Starting Shopify sync worker (interval=%dm, max_orders=%d)",
        settings.shopify_sync_interval_minutes,
        settings.shopify_sync_max_orders,
    )

    scheduler.start()

    # Bloquear el proceso principal indefinidamente.
    # El thread del scheduler corre en daemon=True; este bucle lo mantiene vivo.
    try:
        scheduler._thread.join()  # type: ignore[union-attr]
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received, stopping scheduler...")
        scheduler.stop()


if __name__ == "__main__":
    main()
