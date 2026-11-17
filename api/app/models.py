from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JsonType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class Event(Base):
    """Append-only log. event_id is the idempotency key."""

    __tablename__ = "events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    topic: Mapped[str] = mapped_column(String(200))
    line: Mapped[str] = mapped_column(String(64))
    device: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(32))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict] = mapped_column(JsonType)

    __table_args__ = (
        Index("ix_events_ts", "ts"),
        Index("ix_events_line_device", "line", "device"),
    )


class Device(Base):
    """Latest known state per device (read model)."""

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(130), primary_key=True)  # "{line}/{device}"
    line: Mapped[str] = mapped_column(String(64))
    device: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))
    state: Mapped[str] = mapped_column(String(32), default="unknown")
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Movement(Base):
    """Goods movement derived from RFID tag reads (one row per tag_read event)."""

    __tablename__ = "movements"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    line: Mapped[str] = mapped_column(String(64))
    device: Mapped[str] = mapped_column(String(64))
    tag_id: Mapped[str] = mapped_column(String(64))
    sku: Mapped[str] = mapped_column(String(64), index=True)
    direction: Mapped[str] = mapped_column(String(8))  # "in" | "out"
    qty: Mapped[int] = mapped_column(Integer, default=1)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
