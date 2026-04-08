from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/health")
def healthcheck() -> dict[str, bool]:
    return {"ok": True}


@router.get("/health/ctt-config")
def ctt_config_debug() -> dict:
    """Debug endpoint — muestra las primeras letras de las credenciales CTT para verificar que están correctas en Render."""
    s = get_settings()

    def mask(val: str | None) -> str:
        if not val:
            return "(no configurado)"
        v = val.strip()
        visible = min(4, len(v))
        return v[:visible] + "***" + f" (len={len(v)})"

    return {
        "ctt_client_id": mask(s.ctt_client_id),
        "ctt_client_secret": mask(s.ctt_client_secret),
        "ctt_user_name": mask(s.ctt_user_name),
        "ctt_password": mask(s.ctt_password),
        "ctt_client_center_code": mask(s.ctt_client_center_code),
        "ctt_api_base_url": s.ctt_api_base_url,
    }
