#!/usr/bin/env bash
# 로컬 검증: 단위 테스트, 테스트 케이스 문서 대조, web 빌드(compose용·정적용), E2E(Chrome 이 있을 때).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s ==\n' "$*"; }

for d in api simulator gateway; do
  step "pytest: $d"
  bash scripts/run-pytest.sh "$d"
done

step "web: 단위 테스트 (지표 엔진, 시뮬레이터, 데이터 출처 전이)"
(cd web && npm ci --no-audit --no-fund >/dev/null && npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)')

step "테스트 케이스 문서 대조"
python3 scripts/check-test-cases.py

step "web 빌드: compose 모드 (standalone)"
(cd web && npm run build 2>&1 | grep -E 'Compiled|rror|Route' | head -5)

step "web 빌드: 정적 데모 모드 (export)"
(cd web && NEXT_PUBLIC_DEMO_MODE=static NEXT_PUBLIC_BASE_PATH=/factory-flow-demo npm run build 2>&1 | grep -E 'Compiled|rror' | head -3)
test -f web/out/index.html && echo "out/index.html 생성됨"

if [ -n "${PW_CHANNEL+x}" ] || [ -d "/Applications/Google Chrome.app" ] || command -v google-chrome >/dev/null 2>&1; then
  step "E2E (Playwright)"
  (cd web && npm run test:e2e 2>&1 | grep -E '✓|✘|passed|failed')
else
  echo; echo "E2E 건너뜀: Chrome 이 없습니다 (PW_CHANNEL= 로 Playwright Chromium 사용 가능)"
fi

printf '\nverify 통과\n'
