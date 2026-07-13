# Node toolchain: use Node 22 (see .nvmrc). `make hooks` once per clone.
.PHONY: up migrate gates hooks

up:
	docker compose -f infra/compose/docker-compose.yml up -d

smoke:
	sh infra/smoke.sh

down:
	docker compose -f infra/compose/docker-compose.yml down

migrate:
	cd packages/db && pnpm exec prisma migrate deploy
	pnpm exec tsx packages/db/sql/migrate.ts

# Run all quality gates (the commit gate re-verifies staged packages via turbo cache)
gates:
	pnpm turbo run typecheck lint test

# Normally auto-installed by the package.json "prepare" script on pnpm install
hooks:
	git config core.hooksPath scripts/githooks
	@echo "git hooks path -> scripts/githooks"

.PHONY: alerts-test
alerts-test: ## W7-S1: validate + unit-test the Prometheus alert rules (needs Docker)
	docker run --rm --entrypoint promtool -v "$(PWD)/infra/prometheus":/w prom/prometheus:v3.1.0 check rules /w/alerts.yml
	docker run --rm --entrypoint promtool -v "$(PWD)/infra/prometheus":/w prom/prometheus:v3.1.0 test rules /w/alerts.test.yml
