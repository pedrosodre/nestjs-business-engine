import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sift from 'sift';
import {
	BUSINESS_ENGINE_OPTIONS,
	BusinessEngineOptions,
} from './business-engine.options';
import { InvalidRuleError, RuleEvaluationError } from './errors';
import { DebugStep, Rule, RunOptions, RunResult } from './types';
import { FormulaCache } from './util/formula.util';
import { toPlainValue } from './util/normalize.util';
import { checkRules, RuleIssue, validateRules } from './validation';

/**
 * sift compiles string `$where` conditions with `new Function`, which would let
 * anyone who can write a rule run arbitrary code. Rules are data (often stored
 * in a database), so the operator is disabled.
 */
const SAFE_SIFT_OPERATIONS = {
	$where: () => {
		throw new Error('The $where operator is not supported in rule conditions');
	},
};

/**
 * Copies a rule's default so callers that mutate a result do not change the
 * rule itself. Values that cannot be cloned (functions, class instances with
 * private state) are returned as is.
 */
function cloneDefault(value: unknown): unknown {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	try {
		return structuredClone(value);
	} catch {
		return value;
	}
}

/** State of a single `run()` call. Never stored on the service. */
interface RunContext {
	trace?: DebugStep[];
	bindings?: Record<string, unknown>;
	timeout?: number;
}

@Injectable()
export class BusinessEngineService {
	private readonly formulas: FormulaCache;

	constructor(
		@Optional()
		@Inject(BUSINESS_ENGINE_OPTIONS)
		private readonly defaults: BusinessEngineOptions = {},
	) {
		this.formulas = new FormulaCache(defaults.cacheSize);
	}

	/**
	 * Runs the rules against a payload, in order, and returns the result of
	 * each rule keyed by its id. Rules never see each other's results.
	 */
	async run<TResults extends Record<string, unknown> = Record<string, unknown>>(
		rules: readonly Rule[],
		initialPayload: Record<string, unknown>,
		runOptions: RunOptions = {},
	): Promise<RunResult<TResults>> {
		const options: RunOptions = {
			...runOptions,
			timeout: runOptions.timeout ?? this.defaults.timeout,
			continueOnError:
				runOptions.continueOnError ?? this.defaults.continueOnError,
			bindings: { ...this.defaults.bindings, ...runOptions.bindings },
		};
		const { timeout } = options;
		if (
			timeout !== undefined &&
			(typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0)
		) {
			// A string such as '100' (from an environment variable, say) would
			// otherwise silently disable the timeout.
			throw new TypeError(
				`timeout must be a non-negative number of milliseconds, got ${String(timeout)}`,
			);
		}
		const issues = checkRules(rules, { deep: false });
		if (issues.length > 0) {
			throw new InvalidRuleError(issues);
		}

		const executionId = randomUUID();
		const context: RunContext = {
			trace: options.debug ? [] : undefined,
			bindings: options.bindings,
			timeout: options.timeout,
		};
		const groups =
			options.group === undefined
				? undefined
				: new Set<string | undefined>(
						typeof options.group === 'string' ? [options.group] : options.group,
					);

		this.step(context, 'Starting the business engine', {
			rules,
			initialPayload,
		});

		const results: Record<string, unknown> = {};
		const matched: string[] = [];
		const errors: RuleEvaluationError[] = [];

		for (const rule of rules) {
			if (rule.enabled === false || (groups && !groups.has(rule.group))) {
				continue;
			}

			this.step(context, 'Running a single rule', {
				ruleId: rule.id,
				rule,
			});

			results[rule.id] = cloneDefault(rule.produce.default);

			try {
				const outcome = await this.runRule(rule, initialPayload, context);
				if (outcome.matched) {
					matched.push(rule.id);
					// JSONata returns undefined when a path matches nothing.
					if (outcome.result !== undefined) {
						results[rule.id] = outcome.result;
					}
				}
			} catch (error) {
				if (
					!options.continueOnError ||
					!(error instanceof RuleEvaluationError)
				) {
					throw error;
				}
				errors.push(error);
				this.step(context, 'Rule failed, keeping its default', {
					ruleId: rule.id,
					error: error.message,
				});
			}
		}

		this.step(context, 'Returning all results', {
			results,
			executionId,
		});

		const output: RunResult<TResults> = {
			executionId,
			results: results as TResults,
			matched,
			errors,
		};
		if (context.trace) {
			output.debug = context.trace;
		}
		return output;
	}

	/**
	 * Checks rules without running them. Same as the standalone
	 * `validateRules()`; returns an empty array when the rules are valid.
	 */
	validate(rules: unknown): RuleIssue[] {
		return validateRules(rules);
	}

	private async runRule(
		rule: Rule,
		initialPayload: Record<string, unknown>,
		context: RunContext,
	): Promise<{ matched: boolean; result?: unknown }> {
		const payload = await this.transform(rule, initialPayload, context);
		if (!this.evaluate(rule, payload, context)) {
			return { matched: false };
		}
		return {
			matched: true,
			result: await this.produce(rule, payload, context),
		};
	}

	private step(
		context: RunContext,
		message: string,
		data: Record<string, unknown>,
	): void {
		context.trace?.push({ message, context: data });
	}

	private async transform(
		rule: Rule,
		initialPayload: Record<string, unknown>,
		context: RunContext,
	): Promise<Record<string, unknown>> {
		const payload: Record<string, unknown> = { ...initialPayload };

		for (const transform of rule.transform ?? []) {
			try {
				payload[transform.key] = toPlainValue(
					await this.formulas.evaluate(transform.formula, payload, context),
				);
			} catch (error) {
				throw new RuleEvaluationError(
					rule.id,
					'transform',
					error,
					transform.key,
				);
			}
		}

		this.step(context, 'Transforming initial payload', {
			ruleId: rule.id,
			transform: rule.transform,
			initialPayload,
			payload,
		});

		return payload;
	}

	private evaluate(
		rule: Rule,
		payload: Record<string, unknown>,
		context: RunContext,
	): boolean {
		let shouldProduce: boolean;
		try {
			shouldProduce = sift(rule.when ?? {}, {
				operations: SAFE_SIFT_OPERATIONS,
			})(payload);
		} catch (error) {
			throw new RuleEvaluationError(rule.id, 'when', error);
		}

		this.step(context, 'Evaluating a rule', {
			ruleId: rule.id,
			when: rule.when,
			payload,
			shouldProduce,
		});

		return shouldProduce;
	}

	private async produce(
		rule: Rule,
		payload: Record<string, unknown>,
		context: RunContext,
	): Promise<unknown> {
		let result: unknown;
		try {
			result = toPlainValue(
				await this.formulas.evaluate(rule.produce.formula, payload, context),
			);
		} catch (error) {
			throw new RuleEvaluationError(rule.id, 'produce', error);
		}

		this.step(context, 'Producing the result', {
			ruleId: rule.id,
			produce: rule.produce,
			payload,
			result,
		});

		return result;
	}
}
