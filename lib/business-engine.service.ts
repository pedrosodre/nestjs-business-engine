import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import jsonata from 'jsonata';
import sift from 'sift';
import { RuleEvaluationError } from './errors';
import { DebugStep, Rule } from './types';

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

/** State of a single `run()` call. Never stored on the service. */
interface RunContext {
	trace?: DebugStep[];
}

@Injectable()
export class BusinessEngineService {
	async run(
		rules: Array<Rule>,
		initialPayload: Record<string, unknown>,
		debug: boolean = false,
	): Promise<{
		results: Record<string, unknown>;
		executionId: string;
		debug?: DebugStep[];
	}> {
		const executionId = ulid();
		const context: RunContext = { trace: debug ? [] : undefined };

		this.step(context, 'Starting the business engine', {
			rules,
			initialPayload,
		});

		const results: Record<string, unknown> = {};

		for (const rule of rules) {
			this.step(context, 'Running a single rule', {
				ruleId: rule.id,
				rule,
			});

			results[rule.id] = rule.produce.default;

			const payload = await this.transform(rule, initialPayload, context);

			if (this.evaluate(rule, payload, context)) {
				results[rule.id] = await this.produce(rule, payload, context);
			}
		}

		this.step(context, 'Returning all results', {
			results,
			executionId,
		});

		if (context.trace) {
			return { results, executionId, debug: context.trace };
		}

		return { results, executionId };
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

		for (const transform of rule.transform) {
			try {
				payload[transform.key] = await jsonata(transform.formula).evaluate(
					payload,
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
			shouldProduce = sift(rule.when, {
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
			result = await jsonata(rule.produce.formula).evaluate(payload);
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
