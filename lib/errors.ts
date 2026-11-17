import type { RuleIssue } from './validation';

/** The step of a rule in which a failure happened. */
export type RuleStage = 'transform' | 'when' | 'produce';

/**
 * Base class of every error thrown by the business engine, so all of them can
 * be caught with a single `instanceof BusinessEngineError` check.
 */
export class BusinessEngineError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
	}
}

/** Thrown when a rule fails while it is being evaluated. */
export class RuleEvaluationError extends BusinessEngineError {
	/** Id of the rule that failed. */
	readonly ruleId: string;
	/** Step of the rule that failed. */
	readonly stage: RuleStage;
	/** Transform key being computed, when `stage` is `transform`. */
	readonly key?: string;
	/** JSONata error code (for example `S0207` or `T1006`), when available. */
	readonly code?: string;
	/** Position of the error in the formula, when available. */
	readonly position?: number;

	constructor(ruleId: string, stage: RuleStage, cause: unknown, key?: string) {
		const details = describeCause(cause);
		const target = key === undefined ? stage : `${stage} "${key}"`;
		super(`Rule "${ruleId}" failed at ${target}: ${details.message}`, {
			cause,
		});
		this.ruleId = ruleId;
		this.stage = stage;
		this.key = key;
		this.code = details.code;
		this.position = details.position;
	}
}

/**
 * JSONata throws plain objects (`{ code, position, token, message }`) instead
 * of Error instances; extract what is useful from either form.
 */
function describeCause(cause: unknown): {
	message: string;
	code?: string;
	position?: number;
} {
	if (cause !== null && typeof cause === 'object') {
		const { message, code, position } = cause as Record<string, unknown>;
		const text = typeof message === 'string' ? message : String(cause);
		const codeText = typeof code === 'string' ? code : undefined;
		const pos = typeof position === 'number' ? position : undefined;
		const suffix = codeText
			? pos === undefined
				? ` (${codeText})`
				: ` (${codeText} at position ${pos})`
			: '';
		return { message: text + suffix, code: codeText, position: pos };
	}
	return { message: String(cause) };
}

/** Thrown before evaluation when a rule is malformed or unsafe. */
export class InvalidRuleError extends BusinessEngineError {
	/** Every problem found. */
	readonly issues: readonly RuleIssue[];
	/** Id of the first invalid rule, when it has one. */
	readonly ruleId?: string;

	constructor(issues: readonly RuleIssue[]) {
		const [first] = issues;
		const more =
			issues.length > 1 ? ` (and ${issues.length - 1} more issues)` : '';
		super(`${first?.message ?? 'Invalid rules'}${more}`);
		this.issues = issues;
		this.ruleId = first?.ruleId;
	}
}

/**
 * Thrown (as the `cause` of a RuleEvaluationError) when a formula runs longer
 * than the configured timeout.
 */
export class FormulaTimeoutError extends BusinessEngineError {
	/** Always `TIMEOUT`. */
	readonly code = 'TIMEOUT';

	constructor(
		/** The timeout that was exceeded, in milliseconds. */
		readonly timeout: number,
	) {
		super(`Formula evaluation exceeded the ${timeout} ms timeout`);
	}
}
