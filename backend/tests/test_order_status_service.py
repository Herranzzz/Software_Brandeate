import unittest

from app.models import Order, OrderStatus, ProductionStatus
from app.services.orders import sync_order_status_from_tracking


def make_order(status: OrderStatus) -> Order:
    return Order(
        shop_id=1,
        external_id="EXT-1",
        status=status,
        production_status=ProductionStatus.pending_personalization,
        customer_name="Jane Doe",
        customer_email="jane@example.com",
    )


class SyncOrderStatusFromTrackingTests(unittest.TestCase):
    def test_shipment_creation_advances_operable_statuses_to_shipped(self) -> None:
        for status in (
            OrderStatus.pending,
            OrderStatus.in_progress,
            OrderStatus.ready_to_ship,
        ):
            order = make_order(status)
            sync_order_status_from_tracking(order, "shipment_created")
            self.assertEqual(order.status, OrderStatus.shipped)

    def test_delivered_order_does_not_regress_to_shipped(self) -> None:
        order = make_order(OrderStatus.delivered)
        sync_order_status_from_tracking(order, "in_transit")
        self.assertEqual(order.status, OrderStatus.delivered)

    def test_exception_can_move_to_delivered(self) -> None:
        order = make_order(OrderStatus.exception)
        sync_order_status_from_tracking(order, "delivered")
        self.assertEqual(order.status, OrderStatus.delivered)

    def test_exception_does_not_regress_to_shipped(self) -> None:
        order = make_order(OrderStatus.exception)
        sync_order_status_from_tracking(order, "out_for_delivery")
        self.assertEqual(order.status, OrderStatus.exception)


if __name__ == "__main__":
    unittest.main()
