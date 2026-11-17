import asyncio
import logging

import aiomqtt

from .config import Settings
from .pipeline import Pipeline

log = logging.getLogger("mqtt")


async def run_consumer(settings: Settings, pipeline: Pipeline) -> None:
    """Subscribe forever; reconnect with capped exponential backoff.

    clean_session=False + fixed client id + QoS1 subscription: the broker queues
    messages while the API is down and redelivers them on reconnect.
    """
    backoff = 1.0
    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                identifier=settings.mqtt_client_id,
                clean_session=False,
                keepalive=30,
            ) as client:
                await client.subscribe(settings.mqtt_topic, qos=1)
                pipeline.stats.mqtt_connected = True
                backoff = 1.0
                log.info("subscribed to %s", settings.mqtt_topic)
                async for msg in client.messages:
                    try:
                        await pipeline.handle(str(msg.topic), bytes(msg.payload))
                    except Exception:  # noqa: BLE001 - one bad message must not kill the loop
                        log.exception("handler failed for %s", msg.topic)
        except aiomqtt.MqttError as e:
            log.warning("mqtt connection lost (%s); retry in %.0fs", e, backoff)
        finally:
            pipeline.stats.mqtt_connected = False
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)
