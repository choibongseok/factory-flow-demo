#!/usr/bin/env bash
# 사용: run-pytest.sh <api|simulator|gateway>. Docker 가 있으면 python:3.12 컨테이너, 없으면 로컬 .venv.
set -euo pipefail
cd "$(dirname "$0")/.."
dir="$1"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm -v "$PWD/$dir:/srv" -w /srv python:3.12-slim sh -c \
    "pip install -q --disable-pip-version-check -r requirements-dev.txt 2>&1 | grep -v -E 'notice|WARNING' || true; python -m pytest -q"
else
  python3 -m venv .venv >/dev/null
  .venv/bin/pip install -q -r "$dir/requirements-dev.txt"
  (cd "$dir" && ../.venv/bin/python -m pytest -q)
fi
