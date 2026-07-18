#!/usr/bin/env python3
"""nudg-md local AI relay.

Keeps API keys out of the browser: demo apps on http://localhost:4800 call this
local relay (127.0.0.1:4809), which holds keys in env and shells out to the
local `codex` CLI for multi-agent work. Python 3 stdlib only.

Start:  python3 server/relay.py
Env:    ANTHROPIC_API_KEY   (optional; enables the live-claude quick lane)
        NUDG_QUICK_MODEL    (optional; default "claude-sonnet-5")
        NUDG_CODEX_MODEL    (optional; passed to `codex exec -m`; default = CLI's own default)
        NUDG_RELAY_PORT     (test-only for standalone relay probes; the browser demo uses 4809)

Endpoints:
  GET  /api/health  -> {ok, lanes:{claude, codex}, ts}
  POST /api/quick   -> {question, patient, context}   grounded single answer
  POST /api/panel   -> {question, patient, seats}     2-4 isolated codex reviewers
  POST /api/cancel  -> {runId}                        stops active codex children

Keys are never logged, never echoed in responses, never written to disk.
"""

import json
import os
import re
import signal
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("NUDG_RELAY_PORT", "4809"))
ALLOWED_ORIGINS = {"http://localhost:4800", "http://127.0.0.1:4800"}

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
QUICK_MODEL = os.environ.get("NUDG_QUICK_MODEL", "claude-sonnet-5")
QUICK_MAX_TOKENS = 500
ANTHROPIC_TIMEOUT_S = 60

CODEX_MODEL = os.environ.get("NUDG_CODEX_MODEL", "").strip()  # empty = CLI default
CODEX_TIMEOUT_S = 120
MAX_BODY_BYTES = 256 * 1024
MAX_SEATS = 4
MIN_SEATS = 2
MAX_QUESTION_CHARS = 2000
RUN_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,100}$")
RUN_LOCK = threading.Lock()
RUN_CANCELS = {}
PROCESS_LOCK = threading.Lock()
ACTIVE_PROCESSES = set()
SHUTTING_DOWN = threading.Event()
INSTANCE_ID = os.environ.get("NUDG_RELAY_INSTANCE_ID", "standalone")

QUICK_SYSTEM_PROMPT = (
    "You are a formal-but-friendly clinical decision-support assistant in a DEMO "
    "that uses entirely SYNTHETIC patient data; no real patients are involved. "
    "Answer in 120 words or fewer. Ground every statement strictly in the provided "
    "chart facts; do not invent or assume facts. Never claim or predict outcomes; "
    "the clinician makes all decisions. End with a final line starting with "
    '"Basis: " listing the exact chart facts you used.'
)


class RelayError(Exception):
    """HTTP-mappable relay error (message is safe to return to the client)."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def iso_ts():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def claude_ready():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def codex_ready():
    return shutil.which("codex") is not None


def validate_run_id(body):
    run_id = body.get("runId")
    if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id):
        raise RelayError(400, "runId is required and must be 8-100 safe characters")
    return run_id


def register_run(run_id):
    with RUN_LOCK:
        if run_id in RUN_CANCELS:
            raise RelayError(409, "runId is already active")
        event = threading.Event()
        RUN_CANCELS[run_id] = event
        return event


def unregister_run(run_id, event):
    with RUN_LOCK:
        if RUN_CANCELS.get(run_id) is event:
            RUN_CANCELS.pop(run_id, None)


def cancel_run(run_id):
    with RUN_LOCK:
        event = RUN_CANCELS.get(run_id)
        if event:
            event.set()
        return event is not None


# ---------------------------------------------------------------- lanes


def call_claude(question, patient, context, cancel_event=None):
    """Anthropic Messages API via urllib. Returns (text, model)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RelayError(503, "claude lane unavailable (no key)")
    if cancel_event and cancel_event.is_set():
        raise RelayError(499, "run cancelled")
    user_content = (
        "Chart facts (synthetic patient, JSON):\n"
        + json.dumps(patient, indent=2)
        + "\n\nRecent workflow events:\n"
        + json.dumps(context, indent=2)
        + "\n\nClinician question: "
        + question
    )
    payload = {
        "model": QUICK_MODEL,
        "max_tokens": QUICK_MAX_TOKENS,
        "system": QUICK_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_content}],
    }
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=ANTHROPIC_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Response body is Anthropic's error JSON; it never contains our key.
        try:
            detail = json.loads(exc.read().decode("utf-8"))
            detail = detail.get("error", {}).get("type", "unknown_error")
        except Exception:
            detail = "unreadable_error_body"
        raise RelayError(502, "anthropic api error %s: %s" % (exc.code, detail))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RelayError(502, "anthropic api unreachable: %s" % exc.__class__.__name__)
    text = "".join(
        block.get("text", "")
        for block in data.get("content", [])
        if block.get("type") == "text"
    ).strip()
    if not text:
        raise RelayError(502, "anthropic api returned no text")
    if cancel_event and cancel_event.is_set():
        raise RelayError(499, "run cancelled")
    return text, data.get("model", QUICK_MODEL)


def stop_process_group(proc):
    """Terminate the CLI and its children; escalate only if they ignore SIGTERM."""
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=1.0)
        except (ChildProcessError, subprocess.TimeoutExpired):
            pass
    except ChildProcessError:
        pass


def stop_all_process_groups():
    """Stop every live CLI child before the relay process exits."""
    SHUTTING_DOWN.set()
    with PROCESS_LOCK:
        processes = list(ACTIVE_PROCESSES)
    for proc in processes:
        stop_process_group(proc)


def run_codex(prompt, timeout_s=CODEX_TIMEOUT_S, cancel_event=None):
    """Run one non-interactive codex call. Prompt is a single argv element,
    stdin is DEVNULL, final model output is read from a temp file (-o)."""
    codex_bin = shutil.which("codex")
    if not codex_bin:
        raise RelayError(503, "codex lane unavailable")
    fd, out_path = tempfile.mkstemp(prefix="nudg-relay-", suffix=".txt")
    os.close(fd)
    proc = None
    try:
        cmd = [
            codex_bin,
            "exec",
            "--skip-git-repo-check",
            "-s",
            "read-only",
            "--ephemeral",
            "--color",
            "never",
            "-o",
            out_path,
        ]
        if CODEX_MODEL:
            cmd += ["-m", CODEX_MODEL]
        cmd.append(prompt)  # prompt as ARGUMENT, never via stdin
        with PROCESS_LOCK:
            if SHUTTING_DOWN.is_set():
                raise RelayError(503, "relay is shutting down")
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            ACTIVE_PROCESSES.add(proc)
        deadline = time.monotonic() + timeout_s
        while proc.poll() is None:
            if cancel_event and cancel_event.is_set():
                stop_process_group(proc)
                raise RelayError(499, "run cancelled")
            if time.monotonic() >= deadline:
                stop_process_group(proc)
                raise RelayError(504, "codex call timed out after %ss" % timeout_s)
            time.sleep(0.1)
        try:
            with open(out_path, "r", encoding="utf-8") as fh:
                text = fh.read().strip()
        except OSError:
            text = ""
        if not text:
            raise RelayError(502, "codex exited %s with no output" % proc.returncode)
        return text
    finally:
        if proc is not None:
            stop_process_group(proc)
            with PROCESS_LOCK:
                ACTIVE_PROCESSES.discard(proc)
        try:
            os.unlink(out_path)
        except OSError:
            pass


# ---------------------------------------------------------------- /api/quick


def quick_codex_prompt(question, patient, context):
    return (
        QUICK_SYSTEM_PROMPT
        + "\n\nChart facts (synthetic patient, JSON):\n"
        + json.dumps(patient, indent=2)
        + "\n\nRecent workflow events:\n"
        + json.dumps(context, indent=2)
        + "\n\nClinician question: "
        + question
        + "\n\nReply with the answer text only."
    )


def handle_quick(body, cancel_event=None):
    question = body.get("question")
    if not isinstance(question, str) or not question.strip():
        raise RelayError(400, "question (non-empty string) is required")
    if len(question) > MAX_QUESTION_CHARS:
        raise RelayError(400, "question is too long")
    patient = body.get("patient", {})
    if not isinstance(patient, dict):
        raise RelayError(400, "patient must be a JSON object")
    context = body.get("context", [])
    if not isinstance(context, list):
        raise RelayError(400, "context must be a list")

    started = time.monotonic()
    receipt = {"requested_lane": "quick", "ts": iso_ts()}

    if claude_ready():
        try:
            text, model = call_claude(question, patient, context, cancel_event)
            receipt.update(
                served_mode="live-claude",
                model=model,
                latency_ms=int((time.monotonic() - started) * 1000),
            )
            return {"mode": "live-claude", "text": text, "receipt": receipt}
        except RelayError as exc:
            if not codex_ready():
                raise
            receipt["note"] = "claude failed (%s); fell through to codex" % exc.message

    if codex_ready():
        text = run_codex(quick_codex_prompt(question, patient, context), cancel_event=cancel_event)
        receipt.update(
            served_mode="live-codex",
            model=CODEX_MODEL or "codex-cli-default",
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        return {"mode": "live-codex", "text": text, "receipt": receipt}

    receipt.update(
        served_mode="scripted",
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return {"mode": "scripted", "receipt": receipt}


# ---------------------------------------------------------------- /api/panel


def seat_prompt(lens, patient, question):
    return (
        "You are one isolated reviewer on a clinical demo panel. Look ONLY through "
        'the "%s" lens at a SYNTHETIC case (no real patients).\n'
        "Patient chart facts (JSON):\n%s\n"
        "Question: %s\n"
        "Reply with STRICT JSON only - no markdown fences, no extra text - exactly "
        "this shape:\n"
        '{"stance":"support"|"oppose"|"insufficient","rationale":"<=40 words",'
        '"requests":"what data you need, if stance is insufficient, else empty string"}'
        % (lens, json.dumps(patient, indent=2), question)
    )


def extract_first_json_obj(text):
    """Return the first parseable {...} object in text, else None."""
    decoder = json.JSONDecoder()
    idx = text.find("{")
    while idx != -1:
        try:
            obj, _ = decoder.raw_decode(text, idx)
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass
        idx = text.find("{", idx + 1)
    return None


def parse_seat_reply(raw):
    obj = extract_first_json_obj(raw) if isinstance(raw, str) else None
    if obj is not None:
        stance = obj.get("stance")
        if stance in ("support", "oppose", "insufficient"):
            return {
                "stance": stance,
                "rationale": str(obj.get("rationale", ""))[:400],
                "requests": str(obj.get("requests", ""))[:400],
            }
    return {
        "stance": "insufficient",
        "rationale": "seat returned unparseable output",
        "requests": "",
    }


def handle_panel(body, cancel_event=None):
    question = body.get("question")
    if not isinstance(question, str) or not question.strip():
        raise RelayError(400, "question (non-empty string) is required")
    if len(question) > MAX_QUESTION_CHARS:
        raise RelayError(400, "question is too long")
    patient = body.get("patient", {})
    if not isinstance(patient, dict):
        raise RelayError(400, "patient must be a JSON object")
    seats = body.get("seats")
    if not isinstance(seats, list) or not (MIN_SEATS <= len(seats) <= MAX_SEATS):
        raise RelayError(400, "seats must be a list of %d-%d objects" % (MIN_SEATS, MAX_SEATS))
    for seat in seats:
        if not isinstance(seat, dict):
            raise RelayError(400, "each seat must be an object with id, name, lens")

    started = time.monotonic()
    receipt = {"requested_lane": "panel", "ts": iso_ts()}

    if not codex_ready():
        receipt.update(
            served_mode="scripted",
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        return {"mode": "scripted", "receipt": receipt}

    results = [None] * len(seats)

    def seat_worker(i, seat):
        lens = str(seat.get("lens", "general"))
        try:
            raw = run_codex(seat_prompt(lens, patient, question), CODEX_TIMEOUT_S, cancel_event)
            verdict = parse_seat_reply(raw)
        except RelayError as exc:
            verdict = {
                "stance": "insufficient",
                "rationale": "seat call failed: %s" % exc.message,
                "requests": "",
            }
        results[i] = {
            "id": str(seat.get("id", "seat-%d" % (i + 1))),
            "name": str(seat.get("name", "Seat %d" % (i + 1))),
            "lens": lens,
            **verdict,
        }

    threads = [
        threading.Thread(target=seat_worker, args=(i, seat), daemon=True)
        for i, seat in enumerate(seats)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(CODEX_TIMEOUT_S + 10)
    if cancel_event and cancel_event.is_set():
        raise RelayError(499, "run cancelled")
    for i, seat in enumerate(seats):
        if results[i] is None:  # thread never finished
            results[i] = {
                "id": str(seat.get("id", "seat-%d" % (i + 1))),
                "name": str(seat.get("name", "Seat %d" % (i + 1))),
                "lens": str(seat.get("lens", "general")),
                "stance": "insufficient",
                "rationale": "seat call failed: worker did not finish",
                "requests": "",
            }

    aggregate = {
        "support": sum(1 for r in results if r["stance"] == "support"),
        "total": len(results),
        "requests_data": sum(1 for r in results if r["requests"].strip()),
    }
    receipt.update(
        served_mode="live-codex",
        model=CODEX_MODEL or "codex-cli-default",
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return {"mode": "live-codex", "seats": results, "aggregate": aggregate, "receipt": receipt}


# ---------------------------------------------------------------- http server


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "NudgRelay/1.0"
    protocol_version = "HTTP/1.1"

    # -- helpers

    def send_cors_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def send_json(self, status, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def reject_without_body(self, status, message):
        """Reject safely when the request body will remain unread."""
        self.close_connection = True
        raise RelayError(status, message)

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.reject_without_body(400, "invalid Content-Length")
        if length <= 0:
            raise RelayError(400, "request body required")
        if length > MAX_BODY_BYTES:
            self.reject_without_body(413, "request body too large")
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RelayError(400, "body must be valid JSON")
        if not isinstance(body, dict):
            raise RelayError(400, "body must be a JSON object")
        return body

    def require_allowed_origin(self):
        origin = self.headers.get("Origin", "")
        if origin not in ALLOWED_ORIGINS:
            self.reject_without_body(403, "origin is not allowed")
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.reject_without_body(415, "Content-Type must be application/json")

    def log_message(self, fmt, *args):
        # Method + path + status only; never bodies, headers, or keys.
        print("[relay] %s %s" % (self.log_date_time_string(), fmt % args), flush=True)

    # -- verbs

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        if origin not in ALLOWED_ORIGINS:
            self.send_json(403, {"error": "origin is not allowed"})
            return
        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "lanes": {
                        "claude": "ready" if claude_ready() else "no-key",
                        "codex": "ready" if codex_ready() else "unavailable",
                    },
                    "instance": INSTANCE_ID,
                    "ts": iso_ts(),
                },
            )
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            self.require_allowed_origin()
            if self.path == "/api/quick":
                body = self.read_json_body()
                run_id = validate_run_id(body)
                event = register_run(run_id)
                try:
                    self.send_json(200, handle_quick(body, event))
                finally:
                    unregister_run(run_id, event)
            elif self.path == "/api/panel":
                body = self.read_json_body()
                run_id = validate_run_id(body)
                event = register_run(run_id)
                try:
                    self.send_json(200, handle_panel(body, event))
                finally:
                    unregister_run(run_id, event)
            elif self.path == "/api/cancel":
                body = self.read_json_body()
                run_id = validate_run_id(body)
                self.send_json(200, {"cancelled": cancel_run(run_id), "runId": run_id})
            elif self.path == "/api/health":
                self.close_connection = True
                self.send_json(405, {"error": "use GET for /api/health"})
            else:
                self.close_connection = True
                self.send_json(404, {"error": "not found"})
        except RelayError as exc:
            self.send_json(exc.status, {"error": exc.message})
        except Exception as exc:  # never leak internals beyond the class name
            self.send_json(500, {"error": "internal error: %s" % exc.__class__.__name__})


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True


def main():
    server = RelayServer((HOST, PORT), RelayHandler)

    def handle_shutdown(_signum, _frame):
        stop_all_process_groups()
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, handle_shutdown)
    previous_sighup = signal.signal(signal.SIGHUP, handle_shutdown)
    print(
        "[relay] listening on http://%s:%d  lanes: claude=%s codex=%s"
        % (
            HOST,
            PORT,
            "ready" if claude_ready() else "no-key",
            "ready" if codex_ready() else "unavailable",
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_all_process_groups()
        server.server_close()
        signal.signal(signal.SIGTERM, previous_sigterm)
        signal.signal(signal.SIGHUP, previous_sighup)


if __name__ == "__main__":
    main()
