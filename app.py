import asyncio
import base64
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("gemini_live_demo")

def _resolve_default_project() -> str:
    env_proj = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCP_PROJECT")
    if env_proj:
        return env_proj
    try:
        import google.auth
        _, adc_project = google.auth.default()
        if adc_project:
            return adc_project
    except Exception:
        pass
    return "vertex-ai-live"


DEFAULT_PROJECT = _resolve_default_project()
DEFAULT_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION") or os.environ.get("GCP_LOCATION", "us-central1")
REQUESTED_MODEL_DEFAULT = os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.8-live")
FALLBACK_LIVE_MODEL = "gemini-live-2.5-flash-native-audio"
DEFAULT_VOICE = "Aoede"
DEFAULT_SYSTEM_PROMPT = (
    "Tu es un assistant vocal francophone intelligent, chaleureux et naturel. "
    "Réponds en français de manière claire, concise et conversationnelle, "
    "adaptée à un échange oral fluide en temps réel."
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="LivePulse",
    description="Démonstrateur vocal temps réel Gemini Live sur Google Cloud Vertex AI",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_html_js_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path == "/" or request.url.path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/api/health")
async def health_check():
    """Health & readiness endpoint for Cloud Run and CI/CD smoke tests."""
    return JSONResponse(
        {
            "status": "ok",
            "service": "livepulse",
            "project": DEFAULT_PROJECT,
            "default_region": DEFAULT_LOCATION,
            "default_model": REQUESTED_MODEL_DEFAULT,
            "active_sessions": len( ACTIVE_SESSIONS ) if "ACTIVE_SESSIONS" in globals() else 0,
        }
    )


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def build_live_config(
    system_prompt: str,
    voice_name: str = DEFAULT_VOICE,
    enable_google_search: bool = True,
) -> types.LiveConnectConfig:
    prompt_text = (system_prompt or DEFAULT_SYSTEM_PROMPT).strip()
    tools_list = [types.Tool(google_search=types.GoogleSearch())] if enable_google_search else None
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
            ),
            language_code="fr-FR",
        ),
        tools=tools_list,
        system_instruction=types.Content(
            parts=[types.Part.from_text(text=prompt_text)]
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )


class LiveSessionBridge:
    """Manages a persistent Vertex AI Gemini Live session accessible via HTTP polling/POST (proxy-proof)."""

    def __init__(
        self,
        session_id: str,
        project: str,
        location: str,
        requested_model: str,
        voice_name: str,
        system_prompt: str,
        api_key: Optional[str] = None,
        enable_google_search: bool = True,
    ):
        self.session_id = session_id
        self.project = project
        self.location = location
        self.requested_model = requested_model
        self.active_model = requested_model
        self.fallback_used = False
        self.fallback_reason: Optional[str] = None
        self.voice_name = voice_name
        self.system_prompt = system_prompt
        self.api_key = (api_key or os.environ.get("GEMINI_API_KEY") or "").strip() or None
        self.enable_google_search = bool(enable_google_search)

        if self.api_key:
            self.client = genai.Client(api_key=self.api_key, vertexai=False)
        else:
            self.client = genai.Client(vertexai=True, project=project, location=location)
        self.live_config = build_live_config(
            system_prompt=system_prompt,
            voice_name=voice_name,
            enable_google_search=self.enable_google_search,
        )

        self.event_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self.input_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self.ready_event = asyncio.Event()
        self.stop_event = asyncio.Event()
        self.startup_error: Optional[str] = None
        self.last_activity = time.time()
        self._task: Optional[asyncio.Task] = None

    def start(self):
        self._task = asyncio.create_task(self._run_lifecycle())

    async def _run_lifecycle(self):
        try:
            await self._connect_and_stream(self.requested_model, self.location)
            return
        except Exception as first_err:
            err_str = str(first_err)
            # If user requested gemini-3.1-live, try gemini-3.1-flash-live-preview first
            if self.requested_model.startswith("gemini-3.1") and not self.ready_event.is_set():
                for loc_31 in ([self.location, "us-central1"] if self.location != "us-central1" else ["us-central1"]):
                    try:
                        self.active_model = "gemini-3.1-flash-live-preview"
                        self.location = loc_31
                        self.fallback_used = False
                        await self._connect_and_stream("gemini-3.1-flash-live-preview", loc_31)
                        return
                    except Exception:
                        pass

            # 1. Try gemini-3.8-live-preview in the user's requested location first
            if (self.requested_model.startswith("gemini-3.8-live") or self.requested_model.startswith("gemini-3.1")) and not self.ready_event.is_set():
                try:
                    is_fallback = not self.requested_model.startswith("gemini-3.8-live")
                    self.active_model = "gemini-3.8-live-preview"
                    self.fallback_used = is_fallback
                    if is_fallback:
                        self.fallback_reason = (
                            f"'{self.requested_model}' -> relais assuré par 'gemini-3.8-live-preview' ({self.location})."
                        )
                    await self._connect_and_stream("gemini-3.8-live-preview", self.location)
                    return
                except Exception:
                    pass

            # 2. Try FALLBACK_LIVE_MODEL in the user's requested location (e.g. europe-west1)
            if (
                not self.ready_event.is_set()
                and (
                    "1008" in err_str
                    or "not found" in err_str.lower()
                    or "not supported" in err_str.lower()
                )
            ):
                logger.info(
                    "Session %s: Modèle '%s' non disponible sur %s/%s -> tentative sur '%s' (%s)",
                    self.session_id,
                    self.requested_model,
                    self.project,
                    self.location,
                    FALLBACK_LIVE_MODEL,
                    self.location,
                )
                self.active_model = FALLBACK_LIVE_MODEL
                self.fallback_used = True
                self.fallback_reason = (
                    f"'{self.requested_model}' n'est pas encore publié sur l'endpoint Live de "
                    f"{self.project} ({self.location}). Relais temps réel assuré par '{FALLBACK_LIVE_MODEL}' ({self.location})."
                )
                try:
                    await self._connect_and_stream(FALLBACK_LIVE_MODEL, self.location)
                    return
                except Exception as second_err:
                    sec_str = str(second_err)
                    if self.location != "us-central1" and (
                        "1008" in sec_str or "not found" in sec_str.lower()
                    ):
                        # 3. If the requested region has no Live endpoint at all, relay via us-central1 (preferring 3.8-live-preview)
                        for relay_model in ["gemini-3.8-live-preview", FALLBACK_LIVE_MODEL]:
                            try:
                                self.active_model = relay_model
                                self.fallback_reason = (
                                    f"L'API Live n'est pas encore déployée dans la région '{self.location}' "
                                    f"sur {self.project}. Relais régional assuré par us-central1 ({relay_model})."
                                )
                                await self._connect_and_stream(relay_model, "us-central1")
                                return
                            except Exception as third_err:
                                second_err = third_err

                    self.startup_error = str(second_err)
                    self.ready_event.set()
                    await self.event_queue.put(
                        {"type": "error", "message": f"Erreur Vertex AI Live : {second_err}"}
                    )
            else:
                self.startup_error = err_str
                self.ready_event.set()
                await self.event_queue.put(
                    {"type": "error", "message": f"Erreur Vertex AI Live : {first_err}"}
                )
        finally:
            self.stop_event.set()
            await self.event_queue.put({"type": "session_closed"})

    async def _connect_and_stream(self, model_name: str, target_location: Optional[str] = None):
        loc = target_location or self.location
        client = (
            self.client
            if (self.api_key or loc == self.location)
            else genai.Client(vertexai=True, project=self.project, location=loc)
        )
        async with client.aio.live.connect(model=model_name, config=self.live_config) as session:
            self.active_model = model_name
            self.location = loc
            self.ready_event.set()
            logger.info(
                "Session Live active [%s]: project=%s location=%s model=%s",
                self.session_id,
                self.project,
                self.location,
                model_name,
            )

            async def reader():
                try:
                    while not self.stop_event.is_set():
                        async for response in session.receive():
                            if self.stop_event.is_set():
                                break
                            self.last_activity = time.time()
                            sc = response.server_content
                            if not sc:
                                continue

                            if getattr(sc, "interrupted", False):
                                await self.event_queue.put({"type": "interrupted"})

                            if sc.model_turn and sc.model_turn.parts:
                                for part in sc.model_turn.parts:
                                    if part.inline_data and part.inline_data.data:
                                        b64_audio = base64.b64encode(part.inline_data.data).decode("ascii")
                                        await self.event_queue.put(
                                            {
                                                "type": "audio_out",
                                                "data": b64_audio,
                                                "sample_rate": 24000,
                                            }
                                        )
                                    elif part.text:
                                        await self.event_queue.put(
                                            {"type": "text_out", "text": part.text}
                                        )

                            in_tr = getattr(sc, "input_transcription", None)
                            if in_tr and getattr(in_tr, "text", None):
                                await self.event_queue.put(
                                    {
                                        "type": "transcript_in",
                                        "text": in_tr.text,
                                        "finished": bool(getattr(in_tr, "finished", False)),
                                    }
                                )

                            out_tr = getattr(sc, "output_transcription", None)
                            if out_tr and getattr(out_tr, "text", None):
                                await self.event_queue.put(
                                    {
                                        "type": "transcript_out",
                                        "text": out_tr.text,
                                        "finished": bool(getattr(out_tr, "finished", False)),
                                    }
                                )

                            gm = getattr(sc, "grounding_metadata", None)
                            if gm and self.enable_google_search:
                                queries = list(getattr(gm, "web_search_queries", None) or [])
                                sources = []
                                for chunk in getattr(gm, "grounding_chunks", None) or []:
                                    web_info = getattr(chunk, "web", None)
                                    if web_info:
                                        sources.append(
                                            {
                                                "title": getattr(web_info, "title", None) or "Source Web",
                                                "uri": getattr(web_info, "uri", None) or "",
                                            }
                                        )
                                snippets = []
                                for sup in getattr(gm, "grounding_supports", None) or []:
                                    seg = getattr(sup, "segment", None)
                                    seg_text = getattr(seg, "text", None) if seg else None
                                    if seg_text:
                                        snippets.append(seg_text)

                                if queries or sources or snippets:
                                    await self.event_queue.put(
                                        {
                                            "type": "google_search_result",
                                            "queries": queries,
                                            "sources": sources,
                                            "snippets": snippets,
                                        }
                                    )

                            if getattr(sc, "turn_complete", False):
                                await self.event_queue.put({"type": "turn_complete"})
                except asyncio.CancelledError:
                    pass
                except Exception as exc:
                    if not self.stop_event.is_set():
                        logger.warning("Session %s reader error: %s", self.session_id, exc)
                        await self.event_queue.put(
                            {"type": "error", "message": f"Flux Gemini interrompu : {exc}"}
                        )
                    self.stop_event.set()

            async def writer():
                try:
                    while not self.stop_event.is_set():
                        try:
                            item = await asyncio.wait_for(self.input_queue.get(), timeout=1.0)
                        except asyncio.TimeoutError:
                            if time.time() - self.last_activity > 600:
                                logger.info("Session %s expirée par inactivité", self.session_id)
                                self.stop_event.set()
                                break
                            continue

                        self.last_activity = time.time()
                        itype = item.get("type")
                        if itype == "audio_in":
                            raw_pcm = item["pcm_bytes"]
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=raw_pcm,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                        elif itype == "text_in":
                            user_text = (item.get("text") or "").strip()
                            if user_text:
                                await session.send_client_content(
                                    turns=types.Content(
                                        role="user",
                                        parts=[types.Part.from_text(text=user_text)],
                                    ),
                                    turn_complete=True,
                                )
                        elif itype == "stop":
                            self.stop_event.set()
                            break
                except asyncio.CancelledError:
                    pass
                except Exception as exc:
                    if not self.stop_event.is_set():
                        logger.warning("Session %s writer error: %s", self.session_id, exc)
                    self.stop_event.set()

            r_task = asyncio.create_task(reader())
            w_task = asyncio.create_task(writer())
            await asyncio.wait([r_task, w_task], return_when=asyncio.FIRST_COMPLETED)
            self.stop_event.set()
            r_task.cancel()
            w_task.cancel()

    async def drain_events(self, wait_timeout: float = 0.65) -> List[Dict[str, Any]]:
        self.last_activity = time.time()
        events: List[Dict[str, Any]] = []
        try:
            first = await asyncio.wait_for(self.event_queue.get(), timeout=wait_timeout)
            events.append(first)
        except asyncio.TimeoutError:
            return events

        # Drain any additional buffered events immediately (up to 60 chunks per batch)
        while len(events) < 60 and not self.event_queue.empty():
            try:
                events.append(self.event_queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        return events

    async def close(self):
        self.stop_event.set()
        await self.input_queue.put({"type": "stop"})
        if self._task:
            self._task.cancel()


ACTIVE_SESSIONS: Dict[str, LiveSessionBridge] = {}


@app.get("/")
async def index():
    return FileResponse(
        str(STATIC_DIR / "index.html"),
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@app.get("/api/config")
async def get_config():
    return JSONResponse(
        {
            "project": DEFAULT_PROJECT,
            "location": DEFAULT_LOCATION,
            "requested_model": REQUESTED_MODEL_DEFAULT,
            "fallback_model": FALLBACK_LIVE_MODEL,
            "voice": DEFAULT_VOICE,
            "default_system_prompt": DEFAULT_SYSTEM_PROMPT,
            "active_sessions": len(ACTIVE_SESSIONS),
        }
    )


@app.post("/api/live/start")
async def start_http_live_session(request: Request):
    body = await request.json()
    project = body.get("project") or DEFAULT_PROJECT
    location = body.get("location") or DEFAULT_LOCATION
    requested_model = body.get("model") or REQUESTED_MODEL_DEFAULT
    voice_name = body.get("voice") or DEFAULT_VOICE
    system_prompt = body.get("system_prompt") or DEFAULT_SYSTEM_PROMPT
    api_key = (body.get("api_key") or "").strip() or None
    enable_google_search = body.get("enable_google_search", True)

    session_id = uuid.uuid4().hex[:12]
    bridge = LiveSessionBridge(
        session_id=session_id,
        project=project,
        location=location,
        requested_model=requested_model,
        voice_name=voice_name,
        system_prompt=system_prompt,
        api_key=api_key,
        enable_google_search=bool(enable_google_search),
    )
    ACTIVE_SESSIONS[session_id] = bridge
    bridge.start()

    try:
        await asyncio.wait_for(bridge.ready_event.wait(), timeout=15.0)
    except asyncio.TimeoutError:
        await bridge.close()
        ACTIVE_SESSIONS.pop(session_id, None)
        return JSONResponse(
            status_code=504,
            content={"error": "Délai d'attente dépassé lors de la connexion à Vertex AI Live."},
        )

    if bridge.startup_error:
        err = bridge.startup_error
        await bridge.close()
        ACTIVE_SESSIONS.pop(session_id, None)
        return JSONResponse(status_code=502, content={"error": err})

    return JSONResponse(
        {
            "type": "session_ready",
            "session_id": session_id,
            "project": bridge.project,
            "location": bridge.location,
            "requested_model": bridge.requested_model,
            "active_model": bridge.active_model,
            "fallback_used": bridge.fallback_used,
            "fallback_reason": bridge.fallback_reason,
            "voice": bridge.voice_name,
            "google_search_enabled": bridge.enable_google_search,
            "sample_rate_in": 16000,
            "sample_rate_out": 24000,
        }
    )


@app.post("/api/live/send")
async def send_http_live_input(request: Request):
    body = await request.json()
    session_id = body.get("session_id")
    bridge = ACTIVE_SESSIONS.get(session_id)
    if not bridge or bridge.stop_event.is_set():
        return JSONResponse(status_code=404, content={"error": "Session Live introuvable ou fermée."})

    mtype = body.get("type")
    if mtype == "text_in":
        text = (body.get("text") or "").strip()
        if text:
            await bridge.input_queue.put({"type": "text_in", "text": text})
    elif mtype == "audio_in":
        b64_data = body.get("data")
        if b64_data:
            pcm_bytes = base64.b64decode(b64_data)
            await bridge.input_queue.put({"type": "audio_in", "pcm_bytes": pcm_bytes})

    events = await bridge.drain_events(wait_timeout=0.05)
    return JSONResponse({"ok": True, "events": events, "server_ts": int(time.time() * 1000)})


@app.post("/api/live/poll")
async def poll_http_live_events(request: Request):
    body = await request.json()
    session_id = body.get("session_id")
    bridge = ACTIVE_SESSIONS.get(session_id)
    if not bridge:
        return JSONResponse(status_code=404, content={"error": "Session Live introuvable."})

    events = await bridge.drain_events(wait_timeout=0.65)
    if bridge.stop_event.is_set() and bridge.event_queue.empty():
        ACTIVE_SESSIONS.pop(session_id, None)

    return JSONResponse(
        {
            "ok": True,
            "events": events,
            "active": not bridge.stop_event.is_set(),
            "server_ts": int(time.time() * 1000),
        }
    )


@app.post("/api/live/stop")
async def stop_http_live_session(request: Request):
    body = await request.json()
    session_id = body.get("session_id")
    bridge = ACTIVE_SESSIONS.pop(session_id, None)
    if bridge:
        await bridge.close()
    return JSONResponse({"ok": True})


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    """Fallback direct WebSocket endpoint for local non-proxied connections."""
    await websocket.accept()
    try:
        init_raw = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
        init_data = json.loads(init_raw)
    except Exception:
        await websocket.close(code=1008)
        return

    session_id = uuid.uuid4().hex[:12]
    bridge = LiveSessionBridge(
        session_id=session_id,
        project=init_data.get("project") or DEFAULT_PROJECT,
        location=init_data.get("location") or DEFAULT_LOCATION,
        requested_model=init_data.get("model") or REQUESTED_MODEL_DEFAULT,
        voice_name=init_data.get("voice") or DEFAULT_VOICE,
        system_prompt=init_data.get("system_prompt") or DEFAULT_SYSTEM_PROMPT,
    )
    bridge.start()
    await asyncio.wait_for(bridge.ready_event.wait(), timeout=15.0)
    await websocket.send_json(
        {
            "type": "session_ready",
            "session_id": session_id,
            "project": bridge.project,
            "location": bridge.location,
            "requested_model": bridge.requested_model,
            "active_model": bridge.active_model,
            "fallback_used": bridge.fallback_used,
            "fallback_reason": bridge.fallback_reason,
            "voice": bridge.voice_name,
        }
    )
    try:
        while not bridge.stop_event.is_set():
            events = await bridge.drain_events(wait_timeout=0.1)
            for ev in events:
                await websocket.send_json(ev)
    except WebSocketDisconnect:
        pass
    finally:
        await bridge.close()
