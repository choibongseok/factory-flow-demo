import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("hub")


class Hub:
    """Fan-out of live updates to connected WebSocket clients."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    def __len__(self) -> int:
        return len(self._clients)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, message: dict) -> None:
        if not self._clients:
            return
        text = json.dumps(message)
        clients = list(self._clients)
        results = await asyncio.gather(*(c.send_text(text) for c in clients), return_exceptions=True)
        for c, r in zip(clients, results):
            if isinstance(r, Exception):  # dead/slow socket: drop it, it will reconnect and re-snapshot
                self._clients.discard(c)
