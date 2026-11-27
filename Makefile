NPM ?= npm

.PHONY: all test typecheck

all: typecheck test

# Reinstall from the lockfile whenever it or package.json changes.
node_modules: package.json package-lock.json
	$(NPM) ci
	@touch $@

typecheck: node_modules
	$(NPM) run typecheck

# Regenerate golden fixtures with: UPDATE_GOLDEN=1 make test
test: node_modules
	$(NPM) test
