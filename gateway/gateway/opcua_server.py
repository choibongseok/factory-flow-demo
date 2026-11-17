"""Fake PLC-style machine exposing an OPC-UA address space: a conveyor with a QR scanner and a gate counter."""
import asyncio
import logging
import random

from asyncua import Server

ENDPOINT = "opc.tcp://0.0.0.0:4840/factory/"
NS = "urn:factory-flow:demo"


async def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    server = Server()
    await server.init()
    server.set_endpoint(ENDPOINT)
    idx = await server.register_namespace(NS)
    plc = await server.nodes.objects.add_object(idx, "Conveyor01")
    scan = await plc.add_variable(idx, "LastScanCode", "")
    scan_ok = await plc.add_variable(idx, "LastScanOk", True)
    count = await plc.add_variable(idx, "ParcelCount", 0)
    running = await plc.add_variable(idx, "Running", True)
    seq = await plc.add_variable(idx, "ScanSeq", 0)  # bumps on every scan so a poller can detect new ones
    async with server:
        print(f"OPC-UA server on {ENDPOINT}", flush=True)
        n = 0
        while True:
            await asyncio.sleep(random.uniform(1.5, 4))
            n += 1
            ok = random.random() > 0.08
            await scan.write_value(f"QR-{random.randrange(10**6):06d}")
            await scan_ok.write_value(ok)
            await count.write_value(n)
            await running.write_value(random.random() > 0.03)
            await seq.write_value(n)


if __name__ == "__main__":
    asyncio.run(main())
