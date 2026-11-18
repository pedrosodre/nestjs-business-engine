# AGENTS.md

Guide for AI coding agents working on `nestjs-business-engine`, a NestJS business rules engine: rules are data that transform a payload with JSONata, test a MongoDB-style condition (sift) and produce a result, exposed through `BusinessEngineService.run()`. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

Run from the repository root. Node.js 22.12+ is required.

| Task                                        | Command                                     |
| ------------------------------------------- | ------------------------------------------- |
| Install (also installs git hooks)           | `npm ci`                                    |
| Everything CI runs (use before finishing)   | `npm run check`                             |
| All tests                                   | `npm test`                                  |
| One test file                               | `npx jest tests/unit/run.spec.ts`           |
| One test by name                            | `npx jest -t "uses the default"`            |
| Type check                                  | `npm run typecheck`                         |
| Lint / fix                                  | `npm run lint` / `npx eslint --fix <files>` |
| Format                                      | `npm run format`                            |
| Build `dist/`                               | `npm run build`                             |
| Public API report (after API changes)       | `npm run build && npm run api:update`       |
| Validate the packed package                 | `npm run lint:package`                      |
| Runtime smoke tests (needs `npm run build`) | `npm run test:compat`                       |

Prefer the narrowest command that proves your change (a single test file), then run `npm run check` once at the end. Keep the full output of failing commands.

## Layout

```
lib/index.ts                   public API: everything exported here is public
lib/business-engine.service.ts run(): validate → (per rule) transform → when → produce
lib/business-engine.module.ts  forRoot / forRootAsync
lib/business-engine.options.ts module options and the BUSINESS_ENGINE_OPTIONS token
lib/validation.ts              validateRules(), rulesSchema (Standard Schema) and internal checkRules()
lib/standard-schema.ts         copied Standard Schema v1 interface (no dependency)
lib/errors.ts                  public error classes
lib/types.ts                   public Rule / RunOptions / RunResult types
lib/util/formula.util.ts       internal: JSONata compile cache (LRU) and timeout hook
lib/util/normalize.util.ts     internal: strips JSONata sequence flags from outputs
index.mjs, index.d.mts         ESM entry, re-exports the CommonJS build
etc/                           API Extractor report of the public API
llms.txt                       API summary shipped in the npm package
tests/unit/                    unit tests (most build the service with `new BusinessEngineService()`)
tests/e2e/                     Nest testing module tests and README examples (readme.spec.ts)
tests/compat/                  runtime smoke tests against the built package (CJS + ESM)
```

## How the engine works

- `run()` merges per-run options over module defaults (bindings are merged key by key), then runs `checkRules(rules, { deep: false })` and throws `InvalidRuleError` with every issue before evaluating anything. `validateRules()` is the same check with `deep: true` (also parses every formula with `parseFormula()` and looks for `$where`); `run()` reports unsafe or invalid formulas later, as `RuleEvaluationError`.
- Each rule runs independently on a shallow copy of the initial payload: transforms in order (each result stored under its key), then the sift condition, then the produce formula. Rules never see each other's results.
- A rule's result starts as a `structuredClone` of `produce.default`; it is replaced only when the condition matches and the formula yields something other than `undefined`.
- Formula and condition failures are wrapped in `RuleEvaluationError` (JSONata throws plain objects, not Errors). With `continueOnError` they go to `RunResult.errors`; `InvalidRuleError` is never swallowed.
- Compiled formulas are cached and shared between concurrent runs. Per-run state (bindings, deadline, debug trace) must be passed per evaluation, never stored on the expression or the service. The timeout uses JSONata's `Symbol.for('jsonata.__evaluate_entry')` hook, which reads the deadline from an `AsyncLocalStorage` (never from a JSONata binding: formulas can shadow any variable with `:=`). It is checked between formula steps, so it cannot interrupt one slow operation such as a catastrophic regex or `$sort` of a huge array.
- Formula outputs go through `toPlainValue()` so JSONata's enumerable `sequence` flag never reaches users.
- Every formula is parsed by `parseFormula()` (`lib/util/formula.util.ts`), used by both the cache and `validateRules()`. It rejects, with code `UNSAFE_FORMULA`, formulas that redefine `$clone` (JSONata's transform operator copies objects with whatever `$clone` resolves to, so a redefinition would let formulas modify the caller's payload, bindings and module defaults) or use `$eval` (its formula is only known at run time). `run()` also throws a `TypeError` for a `timeout` that is not a non-negative number.

## Rules

- **Tests are required.** Every bug fix needs a test that fails without the fix; every feature needs tests. Coverage thresholds are enforced.
- **Public API changes are deliberate.** If `npm run api:check` fails, the public API changed: make sure it is intended, run `npm run api:update` and commit the updated `etc/*.api.md`. Internal helpers must not be exported from `lib/index.ts` (it uses explicit exports for `validation.ts`). Breaking changes need `!` in the commit type, a `BREAKING CHANGE:` footer and a MIGRATION.md entry.
- **Keep README.md, `llms.txt` and `tests/e2e/readme.spec.ts` in sync** with public options, methods and errors.
- **Rules are untrusted data.** Never evaluate rule content as JavaScript, keep sift's `$where` disabled, reject `__proto__`/`constructor`/`prototype` wherever rule data becomes a property name, keep formulas from mutating objects they did not create (`$clone`, `$eval` checks), and keep runaway formulas stoppable by `timeout`. Keep per-run state out of JSONata's variable scope.
- **Never edit `dist/`** (generated) or bump the `version` in `package.json` / create tags (semantic-release does it).
- **Keep the ESM entry a re-export of the CommonJS build.** Nest's dependency injection relies on class identity; shipping a second copy of the classes breaks it.
- **No payload values in logs.** The library does not log; the debug trace is returned to the caller only.
- **Style:** Prettier (tabs, single quotes) and ESLint. JSON files use 2 spaces (npm copies `package.json` indentation into the lockfile).
- **Dependencies:** pin exact versions, prefer releases at least two weeks old, and do not add runtime dependencies without a strong reason.
- **Do not read or modify `.npmrc`**, `.env` files or any credentials.

## Commits and pull requests

- Conventional Commits, enforced by commitlint: `fix:`/`perf:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major; `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `style` → no release.
- One logical change per commit, with a body explaining what changed and why.
- Pull requests target `master` and are squash merged (the PR title becomes the commit). `next` is only for the upcoming major version.

## Gotchas

- NestJS 12 is ESM-only and cannot be loaded by Jest's CommonJS runtime. The Jest suite runs against NestJS 11; NestJS 12 is covered by `tests/compat` in CI.
- `rm`, `cp` and `mv` may be aliased to interactive versions in maintainers' shells and hang non-interactive commands; use `command rm -f` / `command cp -f` / `command mv -f`.
- ts-jest caches compiled tests and can miss type errors caused by changes to types in `lib/`. After changing public types, run the affected tests with `npx jest --no-cache <path>` (CI always starts clean).
- JSONata throws plain objects (`{ code, position, token, message }`) and builds arrays with an enumerable `sequence: true`. Never assume `instanceof Error` or plain arrays from JSONata.
- JSONata optimizes tail calls: `( $f := function($n) { $f($n + 1) }; $f(0) )` never overflows the stack. Tests for it must pass a `timeout`.
- Floating point: `$sum` results like `195.10000000000002` are normal; assert with `toBeCloseTo` or `$round` in the formula.
- Coverage counts TypeScript's emitted decorator and re-export helpers as branches, which is why the branch threshold is lower than the others.
- `git rm` of the last file in a folder removes the folder; recreate it before copying files into it.
- JSONata's transform operator (`~> | ... | ... |`) clones through `$clone` looked up in the formula's scope, and lambdas, `:=`, `@$x` and `#$x` can all rebind names. When adding a JSONata feature or upgrading JSONata, check that `findUnsafeFormulaUsage()` still covers every way to rebind `$clone`.
- `package.json` has an `overrides` entry (minimatch for api-extractor). Keep it scoped to that package, and remove it once api-extractor depends on minimatch >= 11.0.1.
- semantic-release pushes the release tag before `npm publish`. A failed publish leaves the tag behind; see MAINTAINING.md before retrying a release.
