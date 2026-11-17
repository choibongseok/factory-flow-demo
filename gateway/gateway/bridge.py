"""OPC-UA -> MQTT bridge. Polls the machine, publishes scan events with the shared topic convention.

event_id is derived from the machine's own sequence number (not a fresh UUID), so if the gateway
restarts and re-reads the same value, the API's idempotent insert drops the repeat.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import aiomqtt
from asyncua import Client

log = logging.getLogger("gateway")
OPCUA_URL = os.getenv("OPCUA_URL", "opc.tcp://localhost:4840/factory/")
MQTT_HOST, MQTT_PORT = os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883"))
LINE, DEVICE = os.getenv("LINE", "line-a"), os.getenv("DEVICE", "scanner-opcua-01")
NS = "urn:factory-flow:demo"


async def bridge_once() -> None:
    async with Client(OPCUA_URL) as opc, aiomqtt.Client(MQTT_HOST, MQTT_PORT, identifier="factory-gateway") as mqtt:
        idx = await opc.get_namespace_index(NS)
        plc = await opc.nodes.objects.get_child([f"{idx}:Conveyor01"])
        seq_n, code_n, ok_n, run_n = [await plc.get_child([f"{idx}:{n}"]) for n in ("ScanSeq", "LastScanCode", "LastScanOk", "Running")]
        log.info("bridging %s -> mqtt %s:%s", OPCUA_URL, MQTT_HOST, MQTT_PORT)
        last = None
        while True:
            seq = await seq_n.read_value()
            if seq != last and seq != 0:
                last = seq
                now = datetime.now(timezone.utc).isoformat()
                scan = {"event_id": f"opcua-{DEVICE}-{seq}", "ts": now, "code": await code_n.read_value(),
                        "result": "ok" if await ok_n.read_value() else "fail"}
                await mqtt.publish(f"factory/{LINE}/{DEVICE}/scan", json.dumps(scan), qos=1)
                state = "active" if await run_n.read_value() else "idle"
                status = {"event_id": f"opcua-{DEVICE}-status-{seq}", "ts": now, "state": state}
                await mqtt.publish(f"factory/{LINE}/{DEVICE}/status", json.dumps(status), qos=1)
            await asyncio.sleep(0.5)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("asyncua").setLevel(logging.WARNING)
    backoff = 1.0
    while True:  # either side may be down at start or restart mid-run
        try:
            await bridge_once()
        except Exception as e:  # noqa: BLE001
            log.warning("bridge error (%s: %s); retry in %.0fs", type(e).__name__, e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


if __name__ == "__main__":
    asyncio.run(main())
