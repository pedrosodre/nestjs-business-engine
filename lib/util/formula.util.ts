import { AsyncLocalStorage } from 'node:async_hooks';
import jsonata from 'jsonata';
import { FormulaTimeoutError } from '../errors';

/** Default number of compiled formulas kept in memory. */
export const DEFAULT_FORMULA_CACHE_SIZE = 500;

/**
 * JSONata calls the function bound to this symbol before evaluating every
 * node of the expression tree. It is how the JSONata exerciser time-boxes
 * expressions, and it is the only way to stop a runaway formula (JSONata
 * optimizes tail calls, so infinite recursion never overflows the stack).
 */
const EVALUATE_ENTRY = Symbol.for('jsonata.__evaluate_entry');

interface Deadline {
	at: number;
	timeout: number;
}

/**
 * Deadline of the evaluation in progress. It is kept outside JSONata so a
 * formula cannot reach it: bindings are JSONata variables, and a formula can
 * shadow any variable with `:=`, which would disable the timeout.
 */
const deadlines = new AsyncLocalStorage<Deadline | undefined>();

function checkDeadline(): void {
	const deadline = deadlines.getStore();
	if (deadline && Date.now() > deadline.at) {
		throw new FormulaTimeoutError(deadline.timeout);
	}
}

/** Options for a single formula evaluation. */
export interface EvaluateOptions {
	bindings?: Record<string, unknown>;
	/** Maximum duration in milliseconds. No limit when undefined or 0. */
	timeout?: number;
}

/**
 * Compiles JSONata formulas and keeps the most recently used ones, so rules
 * evaluated on every request are parsed once. `maxSize: 0` disables caching.
 */
export class FormulaCache {
	private readonly entries = new Map<string, jsonata.Expression>();

	constructor(private readonly maxSize = DEFAULT_FORMULA_CACHE_SIZE) {}

	get size(): number {
		return this.entries.size;
	}

	/** Returns the compiled formula. Throws JSONata's error if it is invalid. */
	compile(formula: string): jsonata.Expression {
		const cached = this.entries.get(formula);
		if (cached) {
			// Refresh the entry so the least recently used one is evicted first.
			this.entries.delete(formula);
			this.entries.set(formula, cached);
			return cached;
		}

		const expression = jsonata(formula);
		// assign() is typed for string names, but JSONata looks this hook up by symbol.
		expression.assign(EVALUATE_ENTRY as unknown as string, checkDeadline);
		if (this.maxSize > 0) {
			if (this.entries.size >= this.maxSize) {
				const oldest = this.entries.keys().next().value as string;
				this.entries.delete(oldest);
			}
			this.entries.set(formula, expression);
		}
		return expression;
	}

	/** Compiles (or reuses) and evaluates a formula. */
	evaluate(
		formula: string,
		input: unknown,
		options: EvaluateOptions = {},
	): Promise<unknown> {
		const expression = this.compile(formula);
		const { bindings, timeout } = options;
		const deadline: Deadline | undefined = timeout
			? { at: Date.now() + timeout, timeout }
			: undefined;
		// Always set the store, so a nested evaluation without a timeout (for
		// example from a binding function) does not inherit the outer deadline.
		return deadlines.run(deadline, () => expression.evaluate(input, bindings));
	}
}
