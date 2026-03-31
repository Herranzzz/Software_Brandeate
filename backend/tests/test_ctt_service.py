import json
import time
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch
from urllib import error as urllib_error

from app.services import ctt as ctt_service


class FakeHTTPResponse:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def _fake_http_error(code: int, body: str) -> urllib_error.HTTPError:
    fp = BytesIO(body.encode())
    exc = urllib_error.HTTPError(url="", code=code, msg="", hdrs=None, fp=fp)  # type: ignore[arg-type]
    return exc


class TestGetToken(unittest.TestCase):
    def setUp(self):
        ctt_service._cached_token = None
        ctt_service._token_expires_at = 0.0

    def _mock_settings(self):
        settings = MagicMock()
        settings.ctt_client_id = "test-id"
        settings.ctt_client_secret = "test-secret"
        settings.ctt_api_base_url = "https://api-test.cttexpress.com"
        return settings

    def test_fetches_token_when_cache_empty(self):
        token_payload = json.dumps({"access_token": "abc123", "expires_in": 86400}).encode()
        with (
            patch("app.services.ctt.get_settings", return_value=self._mock_settings()),
            patch("app.services.ctt.request.urlopen", return_value=FakeHTTPResponse(token_payload)),
        ):
            token = ctt_service.get_token()

        self.assertEqual(token, "abc123")
        self.assertEqual(ctt_service._cached_token, "abc123")

    def test_reuses_cached_token(self):
        ctt_service._cached_token = "cached-token"
        ctt_service._token_expires_at = time.time() + 3600

        with patch("app.services.ctt.request.urlopen") as mock_urlopen:
            token = ctt_service.get_token()
            mock_urlopen.assert_not_called()

        self.assertEqual(token, "cached-token")

    def test_refreshes_expired_token(self):
        ctt_service._cached_token = "old-token"
        ctt_service._token_expires_at = time.time() - 1  # already expired

        new_payload = json.dumps({"access_token": "new-token", "expires_in": 86400}).encode()
        with (
            patch("app.services.ctt.get_settings", return_value=self._mock_settings()),
            patch("app.services.ctt.request.urlopen", return_value=FakeHTTPResponse(new_payload)),
        ):
            token = ctt_service.get_token()

        self.assertEqual(token, "new-token")

    def test_raises_when_credentials_missing(self):
        settings = MagicMock()
        settings.ctt_client_id = None
        settings.ctt_client_secret = None
        settings.ctt_api_base_url = "https://api-test.cttexpress.com"

        with patch("app.services.ctt.get_settings", return_value=settings):
            with self.assertRaises(ctt_service.CTTError):
                ctt_service.get_token()

    def test_raises_on_http_error(self):
        settings = self._mock_settings()
        with (
            patch("app.services.ctt.get_settings", return_value=settings),
            patch(
                "app.services.ctt.request.urlopen",
                side_effect=_fake_http_error(401, '{"error":"invalid_client"}'),
            ),
        ):
            with self.assertRaises(ctt_service.CTTError):
                ctt_service.get_token()


class TestCreateShipping(unittest.TestCase):
    def setUp(self):
        ctt_service._cached_token = "test-token"
        ctt_service._token_expires_at = time.time() + 3600

        settings = MagicMock()
        settings.ctt_api_base_url = "https://api-test.cttexpress.com"
        self._settings_patch = patch("app.services.ctt.get_settings", return_value=settings)
        self._settings_patch.start()

    def tearDown(self):
        self._settings_patch.stop()

    def test_creates_shipping_successfully(self):
        response_body = json.dumps({"shipping_code": "1234567890123456789012"}).encode()
        with patch("app.services.ctt.request.urlopen", return_value=FakeHTTPResponse(response_body)):
            result = ctt_service.create_shipping({"shipping_code": "1234567890123456789012"})

        self.assertEqual(result["shipping_code"], "1234567890123456789012")

    def test_raises_ctt_error_on_http_error(self):
        with patch(
            "app.services.ctt.request.urlopen",
            side_effect=_fake_http_error(400, '{"detail":"Invalid shipping data"}'),
        ):
            with self.assertRaises(ctt_service.CTTError) as ctx:
                ctt_service.create_shipping({})

        self.assertIn("400", str(ctx.exception))


class TestGetLabel(unittest.TestCase):
    def setUp(self):
        ctt_service._cached_token = "test-token"
        ctt_service._token_expires_at = time.time() + 3600

        settings = MagicMock()
        settings.ctt_api_base_url = "https://api-test.cttexpress.com"
        self._settings_patch = patch("app.services.ctt.get_settings", return_value=settings)
        self._settings_patch.start()

    def tearDown(self):
        self._settings_patch.stop()

    def test_returns_pdf_bytes(self):
        fake_pdf = b"%PDF-1.4 fake-content"
        with patch("app.services.ctt.request.urlopen", return_value=FakeHTTPResponse(fake_pdf)):
            result = ctt_service.get_label("1234567890123456789012")

        self.assertEqual(result, fake_pdf)

    def test_raises_ctt_error_on_http_error(self):
        with patch(
            "app.services.ctt.request.urlopen",
            side_effect=_fake_http_error(404, '{"detail":"Shipping not found"}'),
        ):
            with self.assertRaises(ctt_service.CTTError):
                ctt_service.get_label("0000000000000000000000")


if __name__ == "__main__":
    unittest.main()
