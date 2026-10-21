"""Loopback-only prototype service with a bounded, supervised simulation queue."""

import argparse
import fcntl
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pathway.geometry import validate_geometry
from pathway.output import write_json
from pathway.replay import RunRequest
from pathway.schema import canonical_hash

TERMINAL = {"succeeded", "horizon_reached", "failed", "cancelled", "timed_out", "interrupted"}
ID = re.compile(r"^[a-f0-9]{32}$")


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(
        self, root, *, wall_timeout=300, hard_timeout=345, max_jobs=32, max_bytes=2_000_000_000
    ):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock_file = (self.root / "service.lock").open("w")
        fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.wall_timeout, self.hard_timeout = wall_timeout, hard_timeout
        self.max_jobs, self.max_bytes = max_jobs, max_bytes
        self.mutex = threading.RLock()
        self.jobs, self.processes = {}, {}
        self.stopping = threading.Event()
        for path in sorted(self.root.glob("*/job.json")):
            if not ID.fullmatch(path.parent.name):
                continue
            job = json.loads(path.read_text())
            if job["status"] not in TERMINAL:
                job.update(
                    status="interrupted",
                    message="Local service restarted; run was interrupted.",
                    finished_at=timestamp(),
                    result_available=False,
                )
                self._save(job)
            self.jobs[job["id"]] = job
        self.thread = threading.Thread(target=self._work, daemon=True)
        self.thread.start()

    def _save(self, job):
        path = self.root / job["id"] / "job.json"
        tmp = path.with_suffix(".tmp")
        write_json(tmp, job)
        tmp.replace(path)

    def size(self):
        return sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file())

    def list(self):
        with self.mutex:
            return [dict(j) for j in reversed(list(self.jobs.values()))]

    def get(self, key):
        with self.mutex:
            if not ID.fullmatch(key) or key not in self.jobs:
                raise KeyError("unknown run")
            return dict(self.jobs[key])

    def submit(self, request):
        # Validate before consuming a queue slot or creating a directory.
        scenario = request.scenario()
        validate_geometry(scenario)
        with self.mutex:
            if self.stopping.is_set():
                raise RuntimeError("service is stopping")
            if len(self.jobs) >= self.max_jobs:
                raise RuntimeError("Local run storage is full. Start with a new --runs directory.")
            if sum(j["status"] == "queued" for j in self.jobs.values()) >= 2:
                raise RuntimeError("Local queue is full. Wait for a run to finish.")
            if self.size() >= self.max_bytes:
                raise RuntimeError("Local output storage limit reached.")
            key = uuid.uuid4().hex
            path = self.root / key
            path.mkdir()
            write_json(path / "request.json", request.model_dump(mode="json"))
            job = {
                "id": key,
                "request": request.model_dump(mode="json"),
                "request_sha256": canonical_hash(request),
                "scenario_sha256": canonical_hash(scenario),
                "status": "queued",
                "created_at": timestamp(),
                "started_at": None,
                "finished_at": None,
                "result_available": False,
                "message": "Waiting for the local simulator.",
            }
            self.jobs[key] = job
            self._save(job)
            return dict(job)

    def cancel(self, key):
        with self.mutex:
            self.get(key)
            job = self.jobs[key]
            if job["status"] == "queued":
                job.update(
                    status="cancelled", finished_at=timestamp(), message="Cancelled before start."
                )
            elif job["status"] in {"running", "cancelling"}:
                job.update(
                    status="cancelling",
                    message="Stopping the simulator and sealing partial output.",
                )
                if key in self.processes:
                    self.processes[key].terminate()
            self._save(job)
            return dict(job)

    def _work(self):
        while not self.stopping.wait(0.1):
            with self.mutex:
                pending = next((j for j in self.jobs.values() if j["status"] == "queued"), None)
                if pending is None:
                    continue
                key = pending["id"]
                pending.update(
                    status="running",
                    started_at=timestamp(),
                    message="Computing pedestrian movement.",
                )
                self._save(pending)
            path = self.root / key
            process = None
            try:
                with (path / "worker.log").open("wb") as log:
                    process = subprocess.Popen(
                        [
                            sys.executable,
                            "-m",
                            "pathway.webworker",
                            str(path),
                            str(self.wall_timeout),
                            str(os.getpid()),
                        ],
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                        env={**os.environ, "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"},
                    )
                    with self.mutex:
                        self.processes[key] = process
                        if pending["status"] == "cancelling" or self.stopping.is_set():
                            process.terminate()
                    started = time.monotonic()
                    cancel_at = None
                    forced = None
                    while process.poll() is None:
                        elapsed = time.monotonic() - started
                        if pending["status"] == "cancelling" or self.stopping.is_set():
                            if cancel_at is None:
                                cancel_at = time.monotonic()
                                process.terminate()
                            elif time.monotonic() - cancel_at > 8:
                                forced = "cancelled"
                                process.kill()
                        if elapsed > self.hard_timeout:
                            forced = "timed_out"
                            process.kill()
                        if self.size() > self.max_bytes:
                            forced = "failed"
                            process.kill()
                        time.sleep(0.2)
                    process.wait()
                result = path / "result.json"
                with self.mutex:
                    if result.exists() and forced is None:
                        envelope = json.loads(result.read_text())
                        payload = json.loads(envelope["data"])
                        if canonical_hash(payload) != envelope["sha256"]:
                            raise ValueError("invalid result digest")
                        status = payload["manifest"]["status"]
                        pending.update(
                            status=status,
                            result_available=True,
                            message="Result sealed; unfinished visitors are retained.",
                        )
                    else:
                        pending.update(
                            status=forced
                            or (
                                "cancelled"
                                if pending["status"] == "cancelling" or self.stopping.is_set()
                                else "failed"
                            ),
                            result_available=False,
                            message=(
                                "Process stopped without a sealed result. "
                                "Raw partial files remain local."
                            ),
                        )
                    pending["finished_at"] = timestamp()
                    self._save(pending)
            except Exception as exc:
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait()
                with self.mutex:
                    pending.update(
                        status="failed",
                        finished_at=timestamp(),
                        result_available=False,
                        message=f"Simulation worker failed: {type(exc).__name__}.",
                    )
                    self._save(pending)
            finally:
                with self.mutex:
                    self.processes.pop(key, None)

    def close(self):
        self.stopping.set()
        with self.mutex:
            for process in self.processes.values():
                if process.poll() is None:
                    process.terminate()
            for job in self.jobs.values():
                if job["status"] == "queued":
                    job.update(
                        status="cancelled",
                        finished_at=timestamp(),
                        message="Local service stopped.",
                    )
                    self._save(job)
        self.thread.join(timeout=12)
        if self.thread.is_alive():
            with self.mutex:
                for process in self.processes.values():
                    if process.poll() is None:
                        process.kill()
            self.thread.join(timeout=3)
        self.lock_file.close()


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store, static, dev_origin=None):
        self.store, self.static = store, Path(static).resolve()
        super().__init__(address, Handler)
        port = self.server_address[1]
        self.hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        self.origins = {f"http://{host}" for host in self.hosts}
        if dev_origin:
            if dev_origin not in {"http://127.0.0.1:5173", "http://localhost:5173"}:
                raise ValueError("development origin must be loopback port 5173")
            self.origins.add(dev_origin)


class Handler(BaseHTTPRequestHandler):
    server_version = "PathwayLocal/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        data = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def checked(self):
        if self.headers.get("Host") not in self.server.hosts:
            self.reply(403, {"error": "Loopback host required."})
            return False
        if self.headers.get("Origin") and self.headers["Origin"] not in self.server.origins:
            self.reply(403, {"error": "Same-origin local requests required."})
            return False
        if (
            self.command == "POST"
            and self.headers.get("Content-Type", "").split(";")[0] != "application/json"
        ):
            self.reply(415, {"error": "Expected application/json."})
            return False
        return True

    def do_GET(self):
        if not self.checked():
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/bootstrap":
                self.reply(
                    200,
                    {
                        "service": "pathway-local-1",
                        "defaults": RunRequest().model_dump(mode="json"),
                        "jobs": self.server.store.list(),
                        "limits": {
                            "visitors": 750,
                            "concurrent": 1,
                            "pending": 2,
                            "wall_timeout_s": self.server.store.wall_timeout,
                        },
                    },
                )
            elif path == "/api/jobs":
                self.reply(200, self.server.store.list())
            elif path.startswith("/api/jobs/"):
                pieces = path.split("/")
                job = self.server.store.get(pieces[3])
                if len(pieces) == 5 and pieces[4] == "result":
                    if not job["result_available"]:
                        self.reply(409, {"error": job["message"]})
                    else:
                        self.file(self.server.store.root / job["id"] / "result.json", cache=False)
                elif len(pieces) == 4:
                    self.reply(200, job)
                else:
                    self.reply(404, {"error": "Unknown endpoint."})
            elif path.startswith("/api/"):
                self.reply(404, {"error": "Unknown endpoint."})
            else:
                relative = unquote(path).lstrip("/") or "index.html"
                target = (self.server.static / relative).resolve()
                if not target.is_relative_to(self.server.static) or not target.is_file():
                    self.reply(404, {"error": "File not found. Build web/ first."})
                else:
                    self.file(target)
        except KeyError:
            self.reply(
                404, {"error": "Run unavailable; it may belong to a different local session."}
            )

    def file(self, path, *, cache=True):
        self.send_response(200)
        self.send_header(
            "Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        )
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Cache-Control", "no-cache" if cache else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )
        self.end_headers()
        with path.open("rb") as file:
            while chunk := file.read(65536):
                self.wfile.write(chunk)

    def do_POST(self):
        if not self.checked():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536 or self.headers.get("Transfer-Encoding"):
                self.reply(413, {"error": "Request body must be 1–65536 bytes."})
                return
            body = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            if path in {"/api/preview", "/api/jobs"}:
                request = RunRequest.model_validate(body)
                if path == "/api/preview":
                    scenario = request.scenario()
                    validate_geometry(scenario)
                    self.reply(
                        200,
                        {
                            "scenario": scenario.model_dump(mode="json"),
                            "scenario_sha256": canonical_hash(scenario),
                            "request_sha256": canonical_hash(request),
                        },
                    )
                else:
                    self.reply(202, self.server.store.submit(request))
            elif re.fullmatch(r"/api/jobs/[a-f0-9]{32}/cancel", path):
                self.reply(200, self.server.store.cancel(path.split("/")[3]))
            else:
                self.reply(404, {"error": "Unknown endpoint."})
        except (ValueError, TypeError) as exc:
            self.reply(422, {"error": str(exc)[:1500]})
        except KeyError:
            self.reply(404, {"error": "Run not found."})
        except RuntimeError as exc:
            self.reply(429, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--runs", type=Path, default=Path("runs/web"))
    parser.add_argument("--static", type=Path, default=Path("web/dist"))
    parser.add_argument("--dev-origin", choices=["http://127.0.0.1:5173", "http://localhost:5173"])
    args = parser.parse_args()
    store = JobStore(args.runs)
    server = LocalServer(("127.0.0.1", args.port), store, args.static, args.dev_origin)
    print(f"Pathway local prototype: http://127.0.0.1:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        store.close()


if __name__ == "__main__":
    main()
