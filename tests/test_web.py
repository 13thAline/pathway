import hashlib
import http.client
import json
import threading
import time

import pytest

from pathway.replay import RunRequest, export_replay, save_replay
from pathway.runner import run_scenario
from pathway.schema import canonical_hash
from pathway.server import TERMINAL, JobStore, LocalServer


def wait_job(store, key, timeout=25):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = store.get(key)
        if job["status"] in TERMINAL:
            return job
        time.sleep(0.05)
    raise AssertionError(store.get(key))


def test_compact_replay_preserves_accounting_and_hashes(tmp_path):
    request = RunRequest(count=6)
    run_scenario(request.scenario(), tmp_path / "raw")
    value = export_replay(tmp_path / "raw", request, mode="saved")
    save_replay(tmp_path / "demo.json", value)
    envelope = json.loads((tmp_path / "demo.json").read_text())
    assert hashlib.sha256(envelope["data"].encode()).hexdigest() == envelope["sha256"]
    r = json.loads(envelope["data"])
    assert canonical_hash(r) == envelope["sha256"]
    assert r["summary"]["metrics"]["completed_count"] == 6
    assert r["ledger"][-1]["completed"] == 6
    assert r["frames"][0] == {"t": 0, "people": []}
    assert r["frames"][-1]["people"] == []
    assert all(
        abs(f["t"] % 2) < 1e-8 or f["t"] == r["manifest"]["simulated_time_s"] for f in r["frames"]
    )
    with pytest.raises(ValueError, match="does not match"):
        export_replay(tmp_path / "raw", RunRequest(count=7))


@pytest.mark.parametrize(
    "data",
    [
        {"count": True},
        {"count": 751},
        {"seed": -1},
        {"variant": "arbitrary"},
        {"path": "/etc/passwd"},
        {"settings": {"dt_s": float("nan")}},
    ],
)
def test_web_request_bounds(data):
    with pytest.raises(ValueError):
        RunRequest.model_validate(data)


def test_real_worker_and_restart_history(tmp_path):
    store = JobStore(tmp_path)
    try:
        job = store.submit(RunRequest(count=6))
        done = wait_job(store, job["id"])
        assert done["status"] == "succeeded"
        assert done["result_available"]
        replay = json.loads(json.loads((tmp_path / job["id"] / "result.json").read_text())["data"])
        assert replay["mode"] == "fresh"
        assert replay["request"] == job["request"]
    finally:
        store.close()
    restored = JobStore(tmp_path)
    try:
        assert restored.get(job["id"])["status"] == "succeeded"
    finally:
        restored.close()


def test_cooperative_and_hard_timeout_are_explicit(tmp_path):
    store = JobStore(tmp_path / "soft", wall_timeout=0)
    try:
        job = store.submit(RunRequest(count=6))
        done = wait_job(store, job["id"])
        assert done["status"] == "timed_out" and done["result_available"]
        payload = json.loads(
            json.loads((store.root / job["id"] / "result.json").read_text())["data"]
        )
        assert payload["summary"]["metrics"]["unfinished_count"] == 6
        assert not payload["summary"]["usable_for_comparison"]
    finally:
        store.close()
    store = JobStore(tmp_path / "hard", hard_timeout=0.001)
    try:
        job = store.submit(RunRequest(count=750))
        done = wait_job(store, job["id"])
        assert done["status"] == "timed_out" and not done["result_available"]
    finally:
        store.close()


def test_cancel_active_and_pending_without_orphan(tmp_path):
    store = JobStore(tmp_path)
    try:
        first = store.submit(RunRequest(count=750))
        until = time.monotonic() + 10
        while time.monotonic() < until:
            logs = list((tmp_path / first["id"]).glob("raw/events.jsonl"))
            if logs and logs[0].stat().st_size > 0:
                break
            time.sleep(0.02)
        else:
            raise AssertionError("worker did not start")
        second = store.submit(RunRequest(count=6))
        assert store.cancel(second["id"])["status"] == "cancelled"
        store.cancel(first["id"])
        done = wait_job(store, first["id"])
        assert done["status"] == "cancelled"
        assert done["result_available"]
        assert not (tmp_path / second["id"] / "raw").exists()
        assert not store.processes
    finally:
        store.close()


def test_restart_marks_unsealed_and_disk_limits(tmp_path):
    key = "a" * 32
    path = tmp_path / "restart" / key
    path.mkdir(parents=True)
    (path / "job.json").write_text(
        json.dumps({"id": key, "status": "running", "result_available": False})
    )
    store = JobStore(tmp_path / "restart")
    try:
        assert store.get(key)["status"] == "interrupted"
    finally:
        store.close()
    store = JobStore(tmp_path / "full", max_bytes=0)
    try:
        with pytest.raises(RuntimeError, match="storage"):
            store.submit(RunRequest(count=6))
    finally:
        store.close()


@pytest.fixture
def http_server(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("Pathway test")
    store = JobStore(tmp_path / "jobs")
    server = LocalServer(("127.0.0.1", 0), store, static)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        store.close()
        thread.join()


def call(server, path, body=None, headers=None, method=None):
    client = http.client.HTTPConnection(*server.server_address, timeout=5)
    try:
        client.request(
            method or ("POST" if body is not None else "GET"),
            path,
            body=json.dumps(body) if body is not None else None,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        response = client.getresponse()
        return response.status, response.read(), dict(response.getheaders())
    finally:
        client.close()


def test_http_origin_host_traversal_and_validation(http_server):
    server = http_server
    assert call(server, "/api/bootstrap")[0] == 200
    assert call(server, "/api/bootstrap", headers={"Host": "evil.example"})[0] == 403
    assert call(server, "/api/jobs", {}, headers={"Origin": "https://evil.example"})[0] == 403
    assert call(server, "/api/jobs", {}, headers={"Content-Type": "text/plain"})[0] == 415
    assert call(server, "/api/jobs", {"count": 751})[0] == 422
    assert call(server, "/api/preview", {"count": 6})[0] == 200
    assert call(server, "/api/preview", {"settings": {"main_gate_width_m": 0}})[0] == 422
    assert call(server, "/%2e%2e/jobs/service.lock")[0] == 404
    assert call(server, "/api/jobs/not-a-job")[0] == 404
    status, body, headers = call(server, "/")
    assert status == 200 and body == b"Pathway test"
    assert "Content-Security-Policy" in headers


def test_http_queue_to_sealed_result(http_server):
    status, body, _ = call(http_server, "/api/jobs", {"count": 6})
    assert status == 202
    job = json.loads(body)
    assert call(http_server, f"/api/jobs/{job['id']}/result")[0] == 409
    wait_job(http_server.store, job["id"])
    status, body, _ = call(http_server, f"/api/jobs/{job['id']}/result")
    assert status == 200
    assert json.loads(json.loads(body)["data"])["summary"]["population"]["completed"] == 6


def test_cancel_during_worker_startup_is_not_a_failure(tmp_path):
    store = JobStore(tmp_path)
    try:
        job = store.submit(RunRequest(count=750))
        until = time.monotonic() + 10
        while time.monotonic() < until:
            with store.mutex:
                if job["id"] in store.processes:
                    store.cancel(job["id"])
                    break
            time.sleep(0.001)
        else:
            raise AssertionError("worker process never launched")
        done = wait_job(store, job["id"])
        assert done["status"] == "cancelled"
    finally:
        store.close()


def test_pending_queue_and_retained_job_limits(tmp_path):
    store = JobStore(tmp_path / "queue")
    try:
        first = store.submit(RunRequest(count=750))
        until = time.monotonic() + 10
        while time.monotonic() < until and store.get(first["id"])["status"] != "running":
            time.sleep(0.01)
        assert store.get(first["id"])["status"] == "running"
        second = store.submit(RunRequest(count=6))
        third = store.submit(RunRequest(count=7))
        with pytest.raises(RuntimeError, match="queue is full"):
            store.submit(RunRequest(count=8))
        store.cancel(second["id"])
        store.cancel(third["id"])
        store.cancel(first["id"])
    finally:
        store.close()
    store = JobStore(tmp_path / "retained", max_jobs=1)
    try:
        store.submit(RunRequest(count=6))
        with pytest.raises(RuntimeError, match="storage is full"):
            store.submit(RunRequest(count=7))
    finally:
        store.close()
