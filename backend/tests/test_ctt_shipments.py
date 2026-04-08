import unittest

from app.models import Order, OrderStatus, ProductionStatus
from app.schemas.ctt import CTTCreateShippingRequest
from app.services.ctt_shipments import (
    _resolve_recipient_address,
    _resolve_recipient_email,
    _resolve_recipient_name,
    _resolve_recipient_phone,
    _resolve_recipient_postal_code,
    _resolve_recipient_town,
)


def make_order() -> Order:
    return Order(
        shop_id=1,
        external_id="EXT-1",
        status=OrderStatus.ready_to_ship,
        production_status=ProductionStatus.packed,
        customer_name="Jane Doe",
        customer_email="jane@example.com",
        shipping_name=None,
        shipping_phone=None,
        shipping_country_code=None,
        shipping_postal_code=None,
        shipping_address_line1=None,
        shipping_address_line2=None,
        shipping_town=None,
        shopify_shipping_snapshot_json={
            "name": "Jane Doe",
            "address1": "Calle Mayor 10",
            "address2": "2ºA",
            "city": "Madrid",
            "zip": "28001",
            "country_code": "ES",
            "phone": "612345678",
            "email": "jane@example.com",
        },
    )


class CttShipmentResolutionTests(unittest.TestCase):
    def test_recipient_fields_fall_back_to_shopify_snapshot(self) -> None:
        order = make_order()
        payload = CTTCreateShippingRequest(order_id=order.id or 1)

        self.assertEqual(_resolve_recipient_name(order, payload, {}), "Jane Doe")
        self.assertEqual(_resolve_recipient_postal_code(order, payload, {}), "28001")
        self.assertEqual(_resolve_recipient_town(order, payload, {}), "Madrid")
        self.assertEqual(_resolve_recipient_address(order, payload, {}), "Calle Mayor 10 2ºA")
        self.assertEqual(_resolve_recipient_phone(order, payload, {}), "612345678")
        self.assertEqual(_resolve_recipient_email(order, payload, {}), "jane@example.com")


if __name__ == "__main__":
    unittest.main()
