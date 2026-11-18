# nestjs-business-engine

[![npm version](https://img.shields.io/npm/v/nestjs-business-engine)](https://www.npmjs.com/package/nestjs-business-engine)
[![CI](https://github.com/pedrosodre/nestjs-business-engine/actions/workflows/release.yml/badge.svg)](https://github.com/pedrosodre/nestjs-business-engine/actions/workflows/release.yml)
[![license](https://img.shields.io/npm/l/nestjs-business-engine)](LICENSE)
[![downloads](https://img.shields.io/npm/dm/nestjs-business-engine)](https://www.npmjs.com/package/nestjs-business-engine)

Business rules engine for [NestJS](https://nestjs.com). Rules are plain data (JSON you can store in a database or edit in an admin UI): each rule **transforms** the payload with [JSONata](https://jsonata.org), checks a MongoDB-style **condition** with [sift](https://github.com/crcn/sift.js), and **produces** a result.

```ts
const { results } = await engine.run(rules, order);
// { 'vip-discount': 12.5, 'free-shipping': true }
```

- Rules as data: no code deploys to change a discount, a fee or an eligibility check.
- Safe for rules you don't fully trust: no JavaScript execution, formula timeouts and prototype-pollution checks.
- Validation for rule editors (`validateRules()`, also a [Standard Schema](https://standardschema.dev)).
- Custom functions, per-run options, module-wide defaults, a debug trace and typed errors.
- CommonJS and ESM, typed, no dependencies besides JSONata and sift.

## Compatibility

| nestjs-business-engine | Node.js    | NestJS     | TypeScript (for consumers) |
| ---------------------- | ---------- | ---------- | -------------------------- |
| 1.x                    | >= 22.12.0 | 11.x, 12.x | >= 5.0                     |

## Installation

```bash
npm install nestjs-business-engine
```

`@nestjs/common` and `reflect-metadata` are peer dependencies (every Nest application already has them).

## Getting started

Import the module:

```ts
import { Module } from '@nestjs/common';
import { BusinessEngineModule } from 'nestjs-business-engine';

@Module({
	imports: [BusinessEngineModule],
})
export class AppModule {}
```

Inject `BusinessEngineService` and run rules against a payload:

```ts
import { Injectable } from '@nestjs/common';
import { BusinessEngineService, Rule } from 'nestjs-business-engine';

const rules: Rule[] = [
	{
		id: 'vip-discount',
		group: 'pricing',
		transform: [{ key: 'total', formula: '$sum(items.(price * quantity))' }],
		when: { total: { $gte: 100 }, 'customer.tier': 'vip' },
		produce: { default: 0, formula: '$round(total * 0.1, 2)' },
	},
	{
		id: 'free-shipping',
		group: 'shipping',
		when: { 'address.country': { $in: ['PT', 'ES'] } },
		produce: { default: false, formula: 'true' },
	},
];

@Injectable()
export class CheckoutService {
	constructor(private readonly engine: BusinessEngineService) {}

	async quote(order: Record<string, unknown>) {
		const { results } = await this.engine.run(rules, order);
		return results; // { 'vip-discount': 12.5, 'free-shipping': true }
	}
}
```

In a real application, rules usually come from a database. Validate them when they are saved (see [Validating rules](#validating-rules)).

## How a rule works

Every rule runs independently against a copy of the payload, in three steps:

1. **`transform`** (optional): a list of `{ key, formula }`. Each JSONata formula is evaluated against the payload and its value is stored under `key`. Later transforms can use earlier ones.
2. **`when`** (optional): a MongoDB-style query (`$gt`, `$in`, `$elemMatch`, `$and`, `$regex`, dot paths, ...) tested against the transformed payload. A missing `when` always matches.
3. **`produce`**: if the condition matches, the JSONata `formula` is evaluated and becomes the rule's result. Otherwise (or when the formula yields nothing) the result is `default`.

| Field             | Type                                 | Required | Description                                                    |
| ----------------- | ------------------------------------ | -------- | -------------------------------------------------------------- |
| `id`              | `string`                             | yes      | Unique id. Results are keyed by it.                            |
| `group`           | `string`                             | no       | Used to run a subset of rules with the `group` option.         |
| `enabled`         | `boolean`                            | no       | `false` skips the rule. Defaults to `true`.                    |
| `transform`       | `{ key: string; formula: string }[]` | no       | Derived values, computed in order.                             |
| `when`            | `object`                             | no       | MongoDB-style condition. Defaults to `{}` (always matches).    |
| `produce.formula` | `string`                             | yes      | JSONata expression that computes the result.                   |
| `produce.default` | `unknown`                            | no       | Result when the condition fails or the formula yields nothing. |

Rules never see each other's results. To chain decisions, run the engine again with the results merged into the payload.

## Running rules

```ts
const { executionId, results, matched, errors, debug } = await engine.run(
	rules,
	payload,
	{
		group: 'pricing',
		bindings: { vat: 0.23 },
		timeout: 100,
		continueOnError: true,
		debug: true,
	},
);
```

### Options

| Option            | Type                      | Default | Description                                                                                         |
| ----------------- | ------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `group`           | `string \| string[]`      | -       | Only run rules of this group (or these groups).                                                     |
| `bindings`        | `Record<string, unknown>` | `{}`    | Variables and functions available to every formula as `$name`. Merged over module bindings.         |
| `timeout`         | `number` (ms)             | none    | Maximum duration of each formula. A slower formula fails with code `TIMEOUT`.                       |
| `continueOnError` | `boolean`                 | `false` | A failing rule keeps its default and its error goes to `errors` instead of rejecting the whole run. |
| `debug`           | `boolean`                 | `false` | Return a step-by-step trace in `debug`.                                                             |

### Result

| Field         | Type                      | Description                                         |
| ------------- | ------------------------- | --------------------------------------------------- |
| `executionId` | `string`                  | Unique id (UUID) of this run.                       |
| `results`     | `Record<string, unknown>` | Result of every rule that ran, keyed by rule id.    |
| `matched`     | `string[]`                | Ids of the rules whose condition matched, in order. |
| `errors`      | `RuleEvaluationError[]`   | Failed rules (only filled with `continueOnError`).  |
| `debug`       | `DebugStep[]`             | Only with `debug: true`.                            |

Type the results with a generic:

```ts
const { results } = await engine.run<{ 'vip-discount': number }>(rules, order);
results['vip-discount'].toFixed(2);
```

### Custom functions

Bindings make your own code available to formulas. Functions can be async:

```ts
await engine.run(rules, order, {
	bindings: {
		vat: 0.23,
		fx: async (currency: string) => rates.get(currency),
	},
});
// formula: '$round(total * (1 + $vat) * $fx(currency), 2)'
```

JSONata's [built-in functions](https://docs.jsonata.org/overview) (`$sum`, `$round`, `$map`, `$filter`, `$now`, ...) are always available.

## Module configuration

Use `forRoot()` to set defaults for every run. Per-run options override them.

```ts
BusinessEngineModule.forRoot({
	isGlobal: true,
	bindings: { vat: 0.23 },
	timeout: 100,
	continueOnError: false,
	cacheSize: 500,
});
```

Or `forRootAsync()` to build them from other providers:

```ts
BusinessEngineModule.forRootAsync({
	isGlobal: true,
	imports: [RatesModule],
	inject: [RatesService],
	useFactory: (rates: RatesService) => ({
		bindings: { fx: (currency: string) => rates.get(currency) },
		timeout: 100,
	}),
});
```

| Option            | Type                      | Default | Description                                                                                 |
| ----------------- | ------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `isGlobal`        | `boolean`                 | `false` | Register the module globally.                                                               |
| `bindings`        | `Record<string, unknown>` | `{}`    | Default bindings for every run.                                                             |
| `timeout`         | `number` (ms)             | none    | Default `timeout`.                                                                          |
| `continueOnError` | `boolean`                 | `false` | Default `continueOnError`.                                                                  |
| `cacheSize`       | `number`                  | `500`   | Compiled formulas kept in memory (least recently used are evicted). `0` disables the cache. |

Outside Nest, `new BusinessEngineService()` works too.

## Validating rules

Check rules when they are created or edited, before they reach `run()`:

```ts
import { validateRules } from 'nestjs-business-engine';

const issues = validateRules(input);
// [{ ruleId: 'vip', path: [0, 'produce', 'formula'], message: 'Rule "vip": produce formula is invalid at position 5: ...' }]
```

It reports structural problems, missing or duplicate ids, forbidden keys, JSONata syntax errors and unsupported operators. `rulesSchema` exposes the same checks as a [Standard Schema](https://standardschema.dev), so it works with any library that accepts one:

```ts
import { rulesSchema } from 'nestjs-business-engine';

const result = await rulesSchema['~standard'].validate(input);
if (result.issues) throw new BadRequestException(result.issues);
```

`run()` always checks the structure of the rules and rejects with an `InvalidRuleError` before evaluating anything.

## Errors

All errors extend `BusinessEngineError`:

| Error                 | When                                                                                          | Useful fields                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `InvalidRuleError`    | Malformed or unsafe rules (before anything runs).                                             | `issues`, `ruleId`                                                                   |
| `RuleEvaluationError` | A formula or condition failed while running.                                                  | `ruleId`, `stage` (`transform`/`when`/`produce`), `key`, `code`, `position`, `cause` |
| `FormulaTimeoutError` | The `cause` of a `RuleEvaluationError` when a formula exceeded `timeout` (`code: 'TIMEOUT'`). | `timeout`                                                                            |

```ts
try {
	await engine.run(rules, payload);
} catch (error) {
	if (error instanceof RuleEvaluationError) {
		logger.warn(`Rule ${error.ruleId} failed at ${error.stage}: ${error.code}`);
	}
	throw error;
}
```

## Security

Rules are data that may be written by people who should not be able to run code on your servers. The engine is designed for that:

- **No JavaScript execution.** JSONata is a sandboxed expression language, and sift's `$where` operator (which compiles strings with `new Function`) is disabled.
- **Formula timeouts.** JSONata optimizes tail calls, so a recursive formula can run forever. Set `timeout` when rules come from outside your code.
- **Prototype pollution.** `__proto__`, `constructor` and `prototype` are rejected as rule ids and transform keys.
- **No changes to your objects.** JSONata's transform operator copies objects with `$clone`, so formulas cannot redefine `$clone` (which would let them modify your payload or bindings) or use `$eval` (whose formula cannot be checked in advance). Such formulas fail with code `UNSAFE_FORMULA` and are reported by `validateRules()`.
- **Bindings are trusted code.** Only expose functions you would let rule authors call.

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Debugging

With `debug: true`, `run()` returns every step with its context (rules, payloads, condition outcome and result):

```ts
const { debug } = await engine.run(rules, payload, { debug: true });
// [{ message: 'Starting the business engine', context: { ... } }, { message: 'Running a single rule', ... }, ...]
```

The trace contains payload values. Don't log it in production if payloads are sensitive.

## AI assistants

The package ships an [`llms.txt`](llms.txt) with a compact API summary for AI coding assistants (`node_modules/nestjs-business-engine/llms.txt`).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Release notes are on the [GitHub releases page](https://github.com/pedrosodre/nestjs-business-engine/releases).

## License

[MIT](LICENSE) © Pedro Sodré
