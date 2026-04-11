"""Simple SMTP email service.

Configure via environment variables:
  MAIL_HOST      SMTP host (e.g. smtp.gmail.com)
  MAIL_PORT      SMTP port (default 587)
  MAIL_USER      SMTP username / sender address
  MAIL_PASSWORD  SMTP password / app password
  MAIL_FROM      Display name + address, e.g. "Brandeate <noreply@brandeate.com>"
                 Falls back to MAIL_USER if not set.
  MAIL_TLS       "true" (default) to use STARTTLS; "false" to skip.

If MAIL_HOST is not set the send call is a no-op (returns False).
"""
from __future__ import annotations

import logging
import smtplib
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def _get_cfg() -> dict[str, str | int | bool]:
    return {
        "host": os.environ.get("MAIL_HOST", ""),
        "port": int(os.environ.get("MAIL_PORT", "587")),
        "user": os.environ.get("MAIL_USER", ""),
        "password": os.environ.get("MAIL_PASSWORD", ""),
        "from_": os.environ.get("MAIL_FROM", "") or os.environ.get("MAIL_USER", ""),
        "tls": os.environ.get("MAIL_TLS", "true").lower() != "false",
    }


def send_invoice_email(
    *,
    to_email: str,
    to_name: str,
    invoice_number: str,
    invoice_total: str,
    invoice_url: str,
    subject: str | None = None,
    extra_message: str | None = None,
) -> bool:
    """Send invoice notification email. Returns True if sent, False if skipped."""
    cfg = _get_cfg()
    if not cfg["host"]:
        logger.info("MAIL_HOST not configured — skipping email send for %s", invoice_number)
        return False

    subject = subject or f"Factura {invoice_number} – Brandeate"
    html_body = _build_invoice_html(
        to_name=to_name,
        invoice_number=invoice_number,
        invoice_total=invoice_total,
        invoice_url=invoice_url,
        extra_message=extra_message,
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = str(cfg["from_"])
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if cfg["tls"]:
            with smtplib.SMTP(str(cfg["host"]), int(str(cfg["port"]))) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(str(cfg["user"]), str(cfg["password"]))
                smtp.sendmail(str(cfg["from_"]), [to_email], msg.as_string())
        else:
            with smtplib.SMTP_SSL(str(cfg["host"]), int(str(cfg["port"]))) as smtp:
                smtp.login(str(cfg["user"]), str(cfg["password"]))
                smtp.sendmail(str(cfg["from_"]), [to_email], msg.as_string())
        logger.info("Invoice email sent: %s → %s", invoice_number, to_email)
        return True
    except Exception as exc:
        logger.error("Failed to send invoice email %s: %s", invoice_number, exc)
        return False


def _build_invoice_html(
    *,
    to_name: str,
    invoice_number: str,
    invoice_total: str,
    invoice_url: str,
    extra_message: str | None,
) -> str:
    extra = f"<p style='color:#555;font-size:14px;'>{extra_message}</p>" if extra_message else ""
    return f"""
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#e8392b;padding:24px 32px;">
          <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Brandeate</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="color:#111;font-size:18px;font-weight:600;margin:0 0 8px;">Hola {to_name},</p>
          <p style="color:#555;font-size:14px;margin:0 0 24px;">Adjuntamos la factura <strong>{invoice_number}</strong> por un importe de <strong>{invoice_total}</strong>.</p>
          {extra}
          <a href="{invoice_url}" style="display:inline-block;background:#e8392b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Ver factura</a>
          <p style="color:#999;font-size:12px;margin:32px 0 0;">Este mensaje ha sido generado automáticamente por Brandeate Operations Hub.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()
