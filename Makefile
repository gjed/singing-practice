NPM ?= npm

.PHONY: all test typecheck lint

all: typecheck test

# Reinstall from the lockfile whenever it or package.json changes.
node_modules: package.json package-lock.json
	$(NPM) ci
	@touch $@

typecheck: node_modules
	$(NPM) run typecheck

# Lint every exercise and collection, or only the files in FILES:
#   make lint FILES="exercises/range/01-major-arpeggio.vex"
lint: node_modules
	$(NPM) run --silent vex -- lint $(FILES)

# Regenerate golden fixtures with: UPDATE_GOLDEN=1 make test
test: node_modules
	$(NPM) test
