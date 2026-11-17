import asyncio
import json
import os
import time
import uuid

import aiomqtt
import httpx
import pytest

API = os.getenv("API_URL", "http://api:8000")
MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")


def wait_until(fn, timeout=30.0, interval=0.3):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = fn()
            if last:
                return last
        except Exception:  # noqa: BLE001 - server may still be starting
            pass
        time.sleep(interval)
    raise AssertionError(f"condition not met within {timeout}s (last={last!r})")


@pytest.fixture(scope="session", autouse=True)
def stack_ready():
    """Wait until the API reports DB and MQTT connected (real Postgres, real Mosquitto)."""
    def ok():
        c = httpx.get(f"{API}/api/status", timeout=3).json()["checks"]
        return c["db"] == "ok" and c["mqtt"] == "ok"
    wait_until(ok, timeout=90)


@pytest.fixture
def line():
    return f"it-{uuid.uuid4().hex[:8]}"


def publish(topic: str, payload, qos: int = 1, times: int = 1):
    body = payload if isinstance(payload, (bytes, str)) else json.dumps(payload)

    async def go():
        async with aiomqtt.Client(MQTT_HOST, 1883) as c:
            for _ in range(times):
                await c.publish(topic, body, qos=qos)

    asyncio.run(go())


def events(line_name: str, **params):
    return httpx.get(f"{API}/api/events", params={"line": line_name, "limit": 100, **params}, timeout=5).json()


def ts():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
