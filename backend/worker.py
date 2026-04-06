"""
Punto de entrada del worker de background para producción.

Ejecuta los schedulers en un proceso separado, independiente del servidor web.
Esto permite escalar el trabajo asíncrono sin compartir recursos con las
peticiones HTTP.

Uso:
    python worker.py

Variables de entorno relevantes:
    DATABASE_URL
    SHOPIFY_SYNC_ENABLED
    SHOPIFY_SYNC_INTERVAL_MINUTES
    SHOPIFY_SYNC_MAX_ORDERS
    CTT_TRACKING_SYNC_ENABLED
    CTT_TRACKING_SYNC_INTERVAL_MINUTES
    CTT_TRACKING_SYNC_BATCH_SIZE
"""
import logging
import signal
import sys
import threading

from app.core.config import get_settings
from app.services.ctt_tracking_scheduler import scheduler as ctt_tracking_scheduler
from app.services.shopify_scheduler import scheduler as shopify_scheduler


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("worker")


def _handle_sigterm(signum, frame):
    logger.info("SIGTERM received, stopping background schedulers...")
    ctt_tracking_scheduler.stop()
    shopify_scheduler.stop()
    sys.exit(0)


def main() -> None:
    settings = get_settings()

    if not settings.shopify_sync_enabled and not settings.ctt_tracking_sync_enabled:
        logger.info("All background schedulers are disabled. Exiting.")
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)

    if settings.shopify_sync_enabled:
        logger.info(
            "Starting Shopify scheduler (interval=%dm, max_orders=%d)",
            settings.shopify_sync_interval_minutes,
            settings.shopify_sync_max_orders,
        )
        shopify_scheduler.start()

    if settings.ctt_tracking_sync_enabled:
        logger.info(
            "Starting CTT tracking scheduler (interval=%dm, batch_size=%d)",
            settings.ctt_tracking_sync_interval_minutes,
            settings.ctt_tracking_sync_batch_size,
        )
        ctt_tracking_scheduler.start()

    try:
        while True:
            active_threads = [
                thread
                for thread in (
                    getattr(shopify_scheduler, "_thread", None),
                    getattr(ctt_tracking_scheduler, "_thread", None),
                )
                if isinstance(thread, threading.Thread)
            ]
            if not active_threads:
                logger.info("No active background scheduler threads remain. Exiting worker.")
                break

            for thread in active_threads:
                thread.join(timeout=1)
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received, stopping background schedulers...")
        ctt_tracking_scheduler.stop()
        shopify_scheduler.stop()


if __name__ == "__main__":
    main()
