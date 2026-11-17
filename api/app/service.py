"""Ingest pipeline and queries."""
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .models import Device, Event, Movement
from .normalize import NormalizedEvent, as_utc


def device_kind(name: str) -> str:
    n = name.lower()
    if n.startswith("amr"):
        return "amr"
    if n.startswith("gate"):
        return "rfid_gate"
    if n.startswith("scan"):
        return "qr_scanner"
    return "unknown"


def _insert_ignore(session: AsyncSession, model):
    """Dialect-specific INSERT ... ON CONFLICT DO NOTHING."""
    name = session.get_bind().dialect.name
    if name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert(model).on_conflict_do_nothing()


def event_to_dict(e: Event) -> dict[str, Any]:
    return {
        "event_id": e.event_id,
        "line": e.line,
        "device": e.device,
        "type": e.type,
        "ts": as_utc(e.ts).isoformat(),
        "payload": e.payload,
    }


def device_to_dict(d: Device, ttl: int = 20, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    last = as_utc(d.last_seen)
    return {
        "id": d.id,
        "line": d.line,
        "device": d.device,
        "kind": d.kind,
        "state": d.state,
        "x": d.x,
        "y": d.y,
        "battery": d.battery,
        "last_seen": last.isoformat(),
        "online": now - last <= timedelta(seconds=ttl),
    }


async def ingest(
    sf: async_sessionmaker[AsyncSession], ev: NormalizedEvent, ttl: int = 20
) -> tuple[dict, dict] | None:
    """Store one event. Returns (event, device) dicts, or None if event_id was already seen."""
    now = datetime.now(timezone.utc)
    async with sf() as session, session.begin():
        res = await session.execute(
            _insert_ignore(session, Event).values(
                event_id=ev.event_id,
                topic=ev.topic,
                line=ev.line,
                device=ev.device,
                type=ev.type,
                ts=ev.ts,
                received_at=now,
                payload=ev.data,
            )
        )
        if res.rowcount == 0:
            return None  # duplicate delivery: nothing else to do, nothing to broadcast

        if ev.type == "tag_read":
            await session.execute(
                _insert_ignore(session, Movement).values(
                    event_id=ev.event_id,
                    line=ev.line,
                    device=ev.device,
                    tag_id=ev.data["tag_id"],
                    sku=ev.data["sku"],
                    direction=ev.data["direction"],
                    qty=ev.data.get("qty", 1),
                    ts=ev.ts,
                )
            )

        dev_id = f"{ev.line}/{ev.device}"
        dev = await session.get(Device, dev_id)
        if dev is None:
            dev = Device(
                id=dev_id, line=ev.line, device=ev.device, kind=device_kind(ev.device),
                state="unknown", last_seen=ev.ts,
            )
            session.add(dev)
        # Out-of-order protection: an older event must not overwrite newer state.
        if ev.ts >= as_utc(dev.last_seen):
            dev.last_seen = ev.ts
            if ev.type == "position":
                dev.x, dev.y = ev.data["x"], ev.data["y"]
            elif ev.type == "status":
                dev.state = ev.data["state"]
                dev.battery = ev.data.get("battery", dev.battery)
            elif dev.state == "unknown":
                dev.state = "active"
        await session.flush()
        return (
            {
                "event_id": ev.event_id, "line": ev.line, "device": ev.device, "type": ev.type,
                "ts": ev.ts.isoformat(), "payload": ev.data,
            },
            device_to_dict(dev, ttl),
        )


async def list_devices(session: AsyncSession, line: str | None, ttl: int) -> list[dict]:
    q = select(Device).order_by(Device.line, Device.device)
    if line:
        q = q.where(Device.line == line)
    now = datetime.now(timezone.utc)
    return [device_to_dict(d, ttl, now) for d in (await session.scalars(q)).all()]


async def list_events(
    session: AsyncSession,
    line: str | None = None,
    device: str | None = None,
    type: str | None = None,
    limit: int = 50,
    before: datetime | None = None,
) -> list[dict]:
    q = select(Event).order_by(Event.ts.desc(), Event.event_id).limit(limit)
    if line:
        q = q.where(Event.line == line)
    if device:
        q = q.where(Event.device == device)
    if type:
        q = q.where(Event.type == type)
    if before:
        q = q.where(Event.ts < before)
    return [event_to_dict(e) for e in (await session.scalars(q)).all()]


async def inventory(session: AsyncSession, line: str | None = None) -> dict[str, Any]:
    """Inbound/outbound per SKU from RFID gate reads."""
    in_qty = func.coalesce(func.sum(case((Movement.direction == "in", Movement.qty), else_=0)), 0)
    out_qty = func.coalesce(func.sum(case((Movement.direction == "out", Movement.qty), else_=0)), 0)
    q = select(Movement.sku, in_qty.label("inbound"), out_qty.label("outbound"), func.max(Movement.ts).label("last_ts")).group_by(Movement.sku).order_by(Movement.sku)
    if line:
        q = q.where(Movement.line == line)
    items = [
        {
            "sku": r.sku,
            "inbound": int(r.inbound),
            "outbound": int(r.outbound),
            "on_hand": int(r.inbound) - int(r.outbound),
            "last_movement": as_utc(datetime.fromisoformat(r.last_ts) if isinstance(r.last_ts, str) else r.last_ts).isoformat(),
        }
        for r in (await session.execute(q)).all()
    ]
    return {
        "items": items,
        "totals": {
            "inbound": sum(i["inbound"] for i in items),
            "outbound": sum(i["outbound"] for i in items),
            "on_hand": sum(i["on_hand"] for i in items),
        },
    }


async def list_movements(session: AsyncSession, line: str | None, limit: int) -> list[dict]:
    q = select(Movement).order_by(Movement.ts.desc()).limit(limit)
    if line:
        q = q.where(Movement.line == line)
    return [
        {
            "event_id": m.event_id, "line": m.line, "device": m.device, "tag_id": m.tag_id,
            "sku": m.sku, "direction": m.direction, "qty": m.qty, "ts": as_utc(m.ts).isoformat(),
        }
        for m in (await session.scalars(q)).all()
    ]


async def purge_older_than(sf: async_sessionmaker[AsyncSession], hours: float) -> int:
    """Delete events and movements older than `hours`; returns the number of events removed."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    async with sf() as session, session.begin():
        await session.execute(delete(Movement).where(Movement.ts < cutoff))
        res = await session.execute(delete(Event).where(Event.ts < cutoff))
        return res.rowcount or 0
