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

/**
 * Returns why a parsed formula is unsafe to run, or `undefined` if it is fine.
 *
 * JSONata's transform operator (`obj ~> | pattern | update |`) copies its input
 * with whatever `$clone` resolves to in the current scope. A formula that
 * rebinds `$clone` (to `function($o){ $o }`, say) makes the operator write into
 * the original objects: the caller's payload, bindings and module defaults.
 * `$eval` is rejected too, because the formula it evaluates is only known at
 * run time and could rebind `$clone` without this check seeing it.
 */
export function findUnsafeFormulaUsage(ast: unknown): string | undefined {
	const seen = new Set<object>();
	const visit = (node: unknown): string | undefined => {
		if (node === null || typeof node !== 'object' || seen.has(node)) {
			return undefined;
		}
		seen.add(node);
		const n = node as Record<string, unknown>;
		if (n.type === 'variable' && n.value === 'eval') {
			return '$eval is not supported';
		}
		const lhs = n.lhs as Record<string, unknown> | undefined;
		const rebindsClone =
			(n.type === 'bind' &&
				lhs?.type === 'variable' &&
				lhs.value === 'clone') ||
			(n.type === 'lambda' &&
				Array.isArray(n.arguments) &&
				n.arguments.some(
					argument => (argument as { value?: unknown })?.value === 'clone',
				)) ||
			n.focus === 'clone' ||
			n.index === 'clone';
		if (rebindsClone) {
			return '$clone cannot be redefined';
		}
		for (const value of Object.values(n)) {
			const reason = visit(value);
			if (reason !== undefined) {
				return reason;
			}
		}
		return undefined;
	};
	return visit(ast);
}

/** Parses a formula and rejects unsafe usage. Throws on invalid formulas. */
export function parseFormula(formula: string): jsonata.Expression {
	const expression = jsonata(formula);
	const reason = findUnsafeFormulaUsage(expression.ast());
	if (reason !== undefined) {
		throw Object.assign(new Error(reason), { code: 'UNSAFE_FORMULA' });
	}
	return expression;
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

	/**
	 * Returns the compiled formula. Throws JSONata's error if it is invalid,
	 * or an `UNSAFE_FORMULA` error if it uses unsafe features.
	 */
	compile(formula: string): jsonata.Expression {
		const cached = this.entries.get(formula);
		if (cached) {
			// Refresh the entry so the least recently used one is evicted first.
			this.entries.delete(formula);
			this.entries.set(formula, cached);
			return cached;
		}

		const expression = parseFormula(formula);
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
