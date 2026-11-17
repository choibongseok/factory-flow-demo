#!/usr/bin/env bash
# Integration tests against the real stack (Mosquitto + PostgreSQL + API). Needs Docker. Not part of `make verify`.
set -euo pipefail
cd "$(dirname "$0")/.."
P=ffd-it
C=(docker compose -p "$P" -f docker-compose.yml -f docker-compose.integration.yml)
cleanup() { "${C[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${C[@]}" up -d --build mosquitto postgres api
docker run --rm --network "${P}_default" -v "$PWD/integration:/t" -w /t \
  -e API_URL=http://api:8000 -e MQTT_HOST=mosquitto python:3.12-slim sh -c \
  "pip install -q --disable-pip-version-check pytest httpx aiomqtt websockets 2>&1 | grep -v -E 'notice|WARNING' || true; python -m pytest -q -p no:cacheprovider"
