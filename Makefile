# Factory Flow 빌드·검증 진입점. push 전에는 `make verify` 가 0 으로 끝나야 한다.
.PHONY: up down test test-api test-sim test-gateway test-web test-e2e test-integration verify pages

up:
	docker compose up -d --build

down:
	docker compose down

# 단위 테스트 (api, simulator, gateway는 Docker 의 python:3.12 컨테이너, web 은 node)
test: test-api test-sim test-gateway test-web

test-api:
	bash scripts/run-pytest.sh api

test-sim:
	bash scripts/run-pytest.sh simulator

test-gateway:
	bash scripts/run-pytest.sh gateway

test-web:
	cd web && npm ci --no-audit --no-fund >/dev/null && npm test

# 브라우저 E2E (정적 모드를 빌드해 Playwright 로 구동). 로컬 Chrome 을 쓴다. 없으면 PW_CHANNEL= 로 Playwright Chromium 사용.
test-e2e:
	cd web && npm ci --no-audit --no-fund >/dev/null && npm run test:e2e

# 실제 Mosquitto + PostgreSQL + API 를 띄워 통합 테스트 (Docker 필요, verify 에는 포함되지 않음)
test-integration:
	bash scripts/test-integration.sh

# 단위 테스트 + 문서 대조 + web 빌드 2종 + E2E(Chrome 이 있을 때)
verify:
	bash scripts/verify.sh

# GitHub Pages 용 정적 데모를 gh-pages 브랜치에 커밋한다(push 는 하지 않는다).
# 실제 서버에 붙이려면: make pages API_BASE=https://<서비스>.onrender.com
pages:
	API_BASE="$(API_BASE)" bash scripts/deploy-pages.sh
