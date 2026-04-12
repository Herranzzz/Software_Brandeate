from __future__ import annotations
from .base import CarrierProvider
from .ctt_provider import CTTProvider

_REGISTRY: dict[str, CarrierProvider] = {}


def _build_registry() -> dict[str, CarrierProvider]:
    providers: list[CarrierProvider] = [
        CTTProvider(),
    ]
    return {p.code: p for p in providers}


def get_all_carriers() -> list[CarrierProvider]:
    global _REGISTRY
    if not _REGISTRY:
        _REGISTRY = _build_registry()
    return list(_REGISTRY.values())


def get_carrier(code: str) -> CarrierProvider | None:
    global _REGISTRY
    if not _REGISTRY:
        _REGISTRY = _build_registry()
    return _REGISTRY.get(code)
