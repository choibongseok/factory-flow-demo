# Factory Flow 빌드·검증 진입점. push 전에는 `make verify` 가 0 으로 끝나야 한다.
.PHONY: verify up down pages test-api test-sim test-web build-web build-static

up:
	docker compose up -d --build

down:
	docker compose down

# pytest(api, simulator) + 브라우저 시뮬레이터 테스트 + web 빌드(compose용, 정적 데모용)
verify:
	bash scripts/verify.sh

# GitHub Pages 용 정적 데모를 gh-pages 브랜치에 커밋한다(push 는 하지 않는다).
pages:
	bash scripts/deploy-pages.sh
