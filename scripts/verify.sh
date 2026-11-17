#!/usr/bin/env bash
# 로컬 검증. Docker 가 있으면 python:3.12 컨테이너에서 pytest 를 돌려 배포 환경과 맞춘다.
# 없으면 로컬 python3 의 가상환경(.venv)을 쓴다.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s ==\n' "$*"; }

run_py_tests() { # $1 = 디렉터리
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker run --rm -v "$PWD/$1:/srv" -w /srv python:3.12-slim sh -c \
      "pip install -q --disable-pip-version-check -r requirements-dev.txt 2>&1 | grep -v '^\[notice\]' || true; python -m pytest -q"
  else
    python3 -m venv .venv >/dev/null
    .venv/bin/pip install -q -r "$1/requirements-dev.txt"
    (cd "$1" && ../.venv/bin/python -m pytest -q)
  fi
}

step "pytest: api"
run_py_tests api
step "pytest: simulator"
run_py_tests simulator

step "web: 브라우저 시뮬레이터 테스트"
(cd web && npm ci --no-audit --no-fund >/dev/null && npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)')

step "web 빌드: compose 모드 (standalone)"
(cd web && npm run build 2>&1 | grep -E 'Compiled|rror|Static|Route' | head -5)

step "web 빌드: 정적 데모 모드 (export)"
(cd web && NEXT_PUBLIC_DEMO_MODE=static NEXT_PUBLIC_BASE_PATH=/factory-flow-demo npm run build 2>&1 | grep -E 'Compiled|rror' | head -3)
test -f web/out/index.html && echo "out/index.html 생성됨"

printf '\nverify 통과\n'
