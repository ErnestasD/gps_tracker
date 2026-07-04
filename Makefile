# Node toolchain: use Node 22 (see .nvmrc). `make hooks` once per clone.
.PHONY: up migrate gates hooks

up:
	docker compose -f infra/compose/docker-compose.yml up -d

smoke:
	sh infra/smoke.sh

down:
	docker compose -f infra/compose/docker-compose.yml down

migrate:
	@echo "E01-3 not implemented yet: prisma migrate + sql migrator land there"

# Run all quality gates (the commit gate re-verifies staged packages via turbo cache)
gates:
	pnpm turbo run typecheck lint test

# Normally auto-installed by the package.json "prepare" script on pnpm install
hooks:
	git config core.hooksPath scripts/githooks
	@echo "git hooks path -> scripts/githooks"
