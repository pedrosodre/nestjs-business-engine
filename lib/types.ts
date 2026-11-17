import type { RuleEvaluationError } from './errors';

/** A derived value computed by a JSONata formula before the condition runs. */
export type RuleTransform = {
	/** Payload key that receives the value. Later transforms can read it. */
	key: string;
	/** JSONata expression evaluated against the payload. */
	formula: string;
};

/** How a rule computes its result. */
export type RuleProduce = {
	/** Result when the condition does not match or the formula yields nothing. */
	default?: unknown;
	/** JSONata expression evaluated against the transformed payload. */
	formula: string;
};

/** A business rule: transform the payload, test a condition, produce a result. */
export type Rule = {
	/** Unique id. Results are keyed by it. */
	id: string;
	/** Set to `false` to skip the rule (it produces no result). Defaults to `true`. */
	enabled?: boolean;
	/** Optional group, used to run a subset of rules with `RunOptions.group`. */
	group?: string;
	/** Derived values computed in order before the condition. Defaults to none. */
	transform?: Array<RuleTransform>;
	/** MongoDB-style condition (sift). Defaults to `{}`, which always matches. */
	when?: Record<string, unknown>;
	produce: RuleProduce;
};

/** Options for a single `run()` call. */
export type RunOptions = {
	/** Return a step-by-step trace in `RunResult.debug`. Defaults to `false`. */
	debug?: boolean;
	/** Only run rules whose `group` is this value (or one of these values). */
	group?: string | readonly string[];
	/**
	 * Variables and functions available to every formula as `$name`, for
	 * example `{ vat: 0.2, round: (n: number) => Math.round(n) }`.
	 */
	bindings?: Record<string, unknown>;
	/**
	 * When `true`, a rule that fails keeps its default and the error is
	 * reported in `RunResult.errors` instead of rejecting the whole run.
	 * Invalid rules (`InvalidRuleError`) are always rejected. Defaults to `false`.
	 */
	continueOnError?: boolean;
	/**
	 * Maximum duration of each formula evaluation, in milliseconds. A formula
	 * that runs longer fails with a RuleEvaluationError whose code is
	 * `TIMEOUT`. Protects against runaway formulas such as infinite
	 * recursion. Defaults to no limit.
	 */
	timeout?: number;
};

/** What `run()` resolves to. */
export type RunResult<
	TResults extends Record<string, unknown> = Record<string, unknown>,
> = {
	/** Unique id of this execution (UUID v4). */
	executionId: string;
	/** Result of every rule that ran, keyed by rule id. */
	results: TResults;
	/** Ids of the rules whose condition matched, in execution order. */
	matched: string[];
	/** Failures of individual rules. Only filled when `continueOnError` is `true`. */
	errors: RuleEvaluationError[];
	/** Step-by-step trace, only when `RunOptions.debug` is `true`. */
	debug?: DebugStep[];
};

/** One entry of the debug trace returned by `run()` when debug is enabled. */
export type DebugStep = {
	message: string;
	context: Record<string, unknown>;
};
