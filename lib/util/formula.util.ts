import jsonata from 'jsonata';
import { FormulaTimeoutError } from '../errors';

/** Default number of compiled formulas kept in memory. */
export const DEFAULT_FORMULA_CACHE_SIZE = 500;

/** Binding that carries the deadline of the current evaluation. */
const DEADLINE_BINDING = '__businessEngineDeadline';

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

function checkDeadline(
	_node: unknown,
	_input: unknown,
	environment: { lookup(name: string): unknown },
): void {
	const deadline = environment.lookup(DEADLINE_BINDING) as Deadline | undefined;
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
		if (!timeout) {
			return expression.evaluate(input, bindings);
		}
		const deadline: Deadline = { at: Date.now() + timeout, timeout };
		return expression.evaluate(input, {
			...bindings,
			[DEADLINE_BINDING]: deadline,
		});
	}
}
