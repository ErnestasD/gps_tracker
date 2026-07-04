# Node toolchain: use Node 22 (see .nvmrc). `make hooks` once per clone.
.PHONY: up migrate gates hooks

up:
	@echo "E01-2 not implemented yet: docker compose stack lands there"

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
