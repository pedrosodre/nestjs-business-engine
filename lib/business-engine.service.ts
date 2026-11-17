import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import jsonata from 'jsonata';
import sift from 'sift';
import { RuleEvaluationError } from './errors';
import { Rule } from './types';

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

@Injectable()
export class BusinessEngineService {
	private debugSteps: {
		[executionId: string]: Array<{
			message: string;
			context: Record<string, unknown>;
		}>;
	} = {};

	constructor() {}

	private startDebug(executionId: string) {
		this.debugSteps[executionId] = [];
	}

	private addDebugStep(
		executionId: string,
		message: string,
		context: Record<string, unknown>,
	) {
		if (Array.isArray(this.debugSteps[executionId])) {
			this.debugSteps[executionId].push({
				message,
				context,
			});
		}
	}

	private endDebug(executionId: string) {
		delete this.debugSteps[executionId];
	}

	printDebug(executionId: string) {
		const debugData = this.debugSteps[executionId];

		this.endDebug(executionId);

		return debugData;
	}

	async run(
		rules: Array<Rule>,
		initialPayload: Record<string, unknown>,
		debug: boolean = false,
	) {
		const executionId = ulid();
		// const rules = this.exampleRules.filter(rule => rule.group === groupId);
		// const initialPayload = this.examplePayload;

		if (debug) {
			this.startDebug(executionId);
		}

		this.addDebugStep(executionId, 'Starting the business engine', {
			rules,
			initialPayload,
		});

		const results: Record<string, unknown> = {};

		for (const rule of rules) {
			this.addDebugStep(executionId, 'Running a single rule', {
				ruleId: rule.id,
				rule,
			});

			results[rule.id] = rule.produce.default;

			const payload = await this.transform(rule, initialPayload, executionId);

			const shouldProduce = this.evaluate(rule, payload, executionId);

			if (shouldProduce) {
				const result = await this.produce(rule, payload, executionId);
				results[rule.id] = result;
			}
		}

		this.addDebugStep(executionId, 'Returning all results', {
			results,
			executionId,
		});

		if (debug) {
			return { results, executionId, debug: this.printDebug(executionId) };
		}

		return { results, executionId };
	}

	async transform(
		rule: Rule,
		initialPayload: Record<string, unknown>,
		executionId: string,
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

		this.addDebugStep(executionId, 'Transforming initial payload', {
			ruleId: rule.id,
			transform: rule.transform,
			initialPayload,
			payload,
		});

		return payload;
	}

	evaluate(
		rule: Rule,
		payload: Record<string, unknown>,
		executionId: string,
	): boolean {
		let shouldProduce: boolean;
		try {
			shouldProduce = sift(rule.when, {
				operations: SAFE_SIFT_OPERATIONS,
			})(payload);
		} catch (error) {
			throw new RuleEvaluationError(rule.id, 'when', error);
		}

		this.addDebugStep(executionId, 'Evaluating a rule', {
			ruleId: rule.id,
			when: rule.when,
			payload,
			shouldProduce,
		});

		return shouldProduce;
	}

	async produce(
		rule: Rule,
		payload: Record<string, unknown>,
		executionId: string,
	): Promise<unknown> {
		let result: unknown;
		try {
			result = await jsonata(rule.produce.formula).evaluate(payload);
		} catch (error) {
			throw new RuleEvaluationError(rule.id, 'produce', error);
		}

		this.addDebugStep(executionId, 'Producing the result', {
			ruleId: rule.id,
			produce: rule.produce,
			payload,
			result,
		});

		return result;
	}
}
