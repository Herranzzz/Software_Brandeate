from fastapi import APIRouter

from app.core.config import get_settings
from app.services.ctt import CTTError, get_token

router = APIRouter()


@router.get("/health")
def healthcheck() -> dict[str, bool]:
    return {"ok": True}


@router.get("/health/ctt-config")
def ctt_config_debug() -> dict:
    """Debug endpoint — muestra configuración CTT activa y prueba el token en vivo."""
    s = get_settings()

    def mask(val: str | None) -> str:
        if not val:
            return "(no configurado)"
        v = val.strip()
        visible = min(4, len(v))
        return v[:visible] + "***" + f" (len={len(v)})"

    result: dict = {
        "ctt_api_base_url": s.ctt_api_base_url,
        "ctt_client_id": mask(s.ctt_client_id),
        "ctt_client_secret": mask(s.ctt_client_secret),
        "ctt_user_name": mask(s.ctt_user_name),
        "ctt_password": mask(s.ctt_password),
        "ctt_client_center_code": mask(s.ctt_client_center_code),
    }

    # Live token test — tells you immediately if credentials match the URL
    try:
        get_token()
        result["token_test"] = "OK"
    except CTTError as exc:
        result["token_test"] = f"FAILED: {exc}"

    return result
