"""OPC-UA -> MQTT bridge. Polls the machine and publishes scan events with the shared topic convention."""
import asyncio
import logging
import os

import aiomqtt
from asyncua import Client

from .convert import ScanBridge

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
        bridge = ScanBridge(LINE, DEVICE)
        while True:
            seq = await seq_n.read_value()
            if seq != bridge.last_seq:
                msgs = bridge.poll(seq, await code_n.read_value(), await ok_n.read_value(), await run_n.read_value())
                for m in msgs:
                    await mqtt.publish(m.topic, m.payload, qos=m.qos)
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
