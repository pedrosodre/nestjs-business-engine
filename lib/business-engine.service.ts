import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import jsonata from 'jsonata';
import sift from 'sift';
import { InvalidRuleError, RuleEvaluationError } from './errors';
import { DebugStep, Rule, RunOptions, RunResult } from './types';
import { toPlainValue } from './util/normalize.util';

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
 * Keys that would change an object's prototype instead of creating a property.
 * Rule ids and transform keys become property names, so they are rejected.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeRule(rule: Rule): void {
	if (UNSAFE_KEYS.has(rule.id)) {
		throw new InvalidRuleError(
			`Rule id "${rule.id}" is not allowed`,
			rule.id,
		);
	}
	for (const transform of rule.transform ?? []) {
		if (UNSAFE_KEYS.has(transform.key)) {
			throw new InvalidRuleError(
				`Rule "${rule.id}" uses the forbidden transform key "${transform.key}"`,
				rule.id,
			);
		}
	}
}

/** State of a single `run()` call. Never stored on the service. */
interface RunContext {
	trace?: DebugStep[];
}

@Injectable()
export class BusinessEngineService {
	/**
	 * Runs the rules against a payload, in order, and returns the result of
	 * each rule keyed by its id. Rules never see each other's results.
	 */
	async run<
		TResults extends Record<string, unknown> = Record<string, unknown>,
	>(
		rules: readonly Rule[],
		initialPayload: Record<string, unknown>,
		options: RunOptions = {},
	): Promise<RunResult<TResults>> {
		const ids = new Set<string>();
		for (const rule of rules) {
			assertSafeRule(rule);
			if (ids.has(rule.id)) {
				throw new InvalidRuleError(
					`Duplicate rule id "${rule.id}"`,
					rule.id,
				);
			}
			ids.add(rule.id);
		}

		const executionId = randomUUID();
		const context: RunContext = {
			trace: options.debug ? [] : undefined,
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

		for (const rule of rules) {
			if (rule.enabled === false || (groups && !groups.has(rule.group))) {
				continue;
			}

			this.step(context, 'Running a single rule', {
				ruleId: rule.id,
				rule,
			});

			results[rule.id] = rule.produce.default;

			const payload = await this.transform(rule, initialPayload, context);

			if (this.evaluate(rule, payload, context)) {
				matched.push(rule.id);
				const result = await this.produce(rule, payload, context);
				// JSONata returns undefined when a path matches nothing.
				if (result !== undefined) {
					results[rule.id] = result;
				}
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
		};
		if (context.trace) {
			output.debug = context.trace;
		}
		return output;
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
					await jsonata(transform.formula).evaluate(payload),
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
				await jsonata(rule.produce.formula).evaluate(payload),
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
