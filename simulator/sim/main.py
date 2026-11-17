import asyncio
import logging
import os
import random

import aiomqtt

from .devices import build_fleet
from .events import Message

log = logging.getLogger("sim")


class Config:
    host = os.getenv("MQTT_HOST", "localhost")
    port = int(os.getenv("MQTT_PORT", "1883"))
    lines = int(os.getenv("LINES", "2"))
    amrs = int(os.getenv("AMRS_PER_LINE", "2"))
    tick = float(os.getenv("TICK_SECONDS", "1.0"))
    seed = int(os.environ["SEED"]) if os.getenv("SEED") else None
    # Fraction of messages published twice, to exercise the consumer's idempotency.
    dup_rate = float(os.getenv("DUP_RATE", "0.03"))
    outbox = int(os.getenv("OUTBOX_SIZE", "5000"))


async def generate(cfg: Config, queue: asyncio.Queue) -> None:
    fleet = build_fleet(cfg.lines, cfg.amrs, cfg.seed)
    rng = random.Random(cfg.seed)
    while True:
        for msg in fleet.tick(cfg.tick):
            _enqueue(queue, msg)
            if rng.random() < cfg.dup_rate:
                _enqueue(queue, msg)  # same event_id again
        await asyncio.sleep(cfg.tick)


def _enqueue(queue: asyncio.Queue, msg: Message) -> None:
    if queue.full():
        # Broker down for a long time: shed oldest to bound memory (position is the cheapest to lose).
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
        log.warning("outbox full, dropped oldest message")
    queue.put_nowait(msg)


async def publish_forever(cfg: Config, queue: asyncio.Queue) -> None:
    """Drain the outbox; on any broker error reconnect with backoff and resend the unsent message."""
    backoff, pending = 1.0, None
    while True:
        try:
            async with aiomqtt.Client(cfg.host, cfg.port, identifier="factory-sim", keepalive=30) as client:
                log.info("connected to %s:%s", cfg.host, cfg.port)
                backoff = 1.0
                while True:
                    pending = pending or await queue.get()
                    await client.publish(pending.topic, pending.payload, qos=pending.qos)
                    pending = None
        except aiomqtt.MqttError as e:
            log.warning("mqtt error (%s); reconnect in %.0fs, outbox=%d", e, backoff, queue.qsize())
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Config()
    queue: asyncio.Queue = asyncio.Queue(maxsize=cfg.outbox)
    await asyncio.gather(generate(cfg, queue), publish_forever(cfg, queue))


if __name__ == "__main__":
    asyncio.run(main())
