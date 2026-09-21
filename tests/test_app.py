"""
Functional and Security Tests for LivePulse (Vertex AI Gemini Live Demonstrator).
Executed automatically in GitHub Actions CI before Cloud Run deployment.
"""

from pathlib import Path
import sys
from unittest.mock import patch
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as livepulse_app

client = TestClient(livepulse_app.app)


def test_health_endpoint():
    """Verify /api/health returns 200 OK and expected service metadata."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "livepulse"
    assert isinstance(data["project"], str) and len(data["project"]) > 0


def test_security_headers_and_cache_control():
    """Verify HTTP security headers and anti-caching headers on index.html and static JS."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
    assert "no-store" in resp.headers.get("Cache-Control", "")


def test_ui_branding_and_selectors():
    """Verify LivePulse UI contains the required selectors (REGION, MODEL, VOICE) and models."""
    resp = client.get("/")
    html = resp.text
    assert "LIVEPULSE" in html
    assert 'id="regionSelect"' in html
    assert 'id="modelSelect"' in html
    assert 'id="voiceSelect"' in html
    assert "gemini-3.8-live-preview" in html
    assert "gemini-3.8-live" in html
    assert "gemini-3.1-live" in html
    assert 'id="googleSearchToggle"' in html
    # Verify carrierNotice banner was removed
    assert 'id="carrierNotice"' not in html


def test_static_avatar_assets_exist():
    """Verify all 6 studio portrait keyframes and app.js are served properly."""
    for asset in [
        "/static/app.js",
        "/static/styles.css",
        "/static/avatar_female_idle.jpg",
        "/static/avatar_female_speaking.jpg",
        "/static/avatar_female_blink.jpg",
        "/static/avatar_male_idle.jpg",
        "/static/avatar_male_speaking.jpg",
        "/static/avatar_male_blink.jpg",
    ]:
        r = client.get(asset)
        assert r.status_code == 200, f"Missing static asset: {asset}"


def test_live_session_lifecycle_mocked():
    """Verify /api/live/start, /api/live/poll, /api/live/send, and /api/live/stop."""

    import asyncio

    class DummyBridge:
        def __init__(self, session_id, project, location, requested_model, voice_name, system_prompt, api_key=None, enable_google_search=True):
            self.session_id = session_id
            self.project = project
            self.location = location
            self.requested_model = requested_model
            self.active_model = requested_model
            self.voice_name = voice_name
            self.enable_google_search = enable_google_search
            self.fallback_used = False
            self.fallback_reason = None
            self.startup_error = None
            self.input_queue = asyncio.Queue()

            class ReadyEvt:
                async def wait(self_inner):
                    return True

            class StopEvt:
                def is_set(self_inner):
                    return False

            self.ready_event = ReadyEvt()
            self.stop_event = StopEvt()

        def start(self):
            pass

        async def drain_events(self, wait_timeout=0.0):
            return [{"type": "transcript_out", "text": "Bonjour depuis LivePulse !", "finished": True}]

        async def close(self):
            pass

    with patch.object(livepulse_app, "LiveSessionBridge", DummyBridge):
        start_resp = client.post(
            "/api/live/start",
            json={
                "project": "test-gcp-project",
                "location": "europe-west4",
                "model": "gemini-3.8-live-preview",
                "voice": "Aoede",
                "system_prompt": "Test system prompt",
                "enable_google_search": True,
            },
        )
        assert start_resp.status_code == 200
        start_data = start_resp.json()
        assert start_data["type"] == "session_ready"
        assert start_data["location"] == "europe-west4"
        assert start_data["active_model"] == "gemini-3.8-live-preview"
        assert start_data["voice"] == "Aoede"
        assert start_data["google_search_enabled"] is True
        sid = start_data["session_id"]

        poll_resp = client.post("/api/live/poll", json={"session_id": sid})
        assert poll_resp.status_code == 200
        poll_data = poll_resp.json()
        assert poll_data["active"] is True
        assert len(poll_data["events"]) == 1

        send_resp = client.post(
            "/api/live/send",
            json={"session_id": sid, "type": "text_in", "text": "Bonjour"},
        )
        assert send_resp.status_code == 200

        stop_resp = client.post("/api/live/stop", json={"session_id": sid})
        assert stop_resp.status_code == 200
        assert stop_resp.json()["ok"] is True


def test_unknown_session_returns_404():
    """Verify polling a non-existent session_id returns 404 safely."""
    r = client.post("/api/live/poll", json={"session_id": "nonexistent123"})
    assert r.status_code == 404
