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

/** JSONata calls the function bound to this symbol after evaluating every node. */
const EVALUATE_EXIT = Symbol.for('jsonata.__evaluate_exit');

interface Deadline {
	at: number;
	timeout: number;
}

/** State of the evaluation in progress. */
interface Evaluation {
	deadline?: Deadline;
	/** Arrays seen by `removeForeignFlag()`, for formulas that need `removeForeignFlags()`. */
	foreignArrays?: Set<unknown[]>;
}

/**
 * State of the evaluation in progress. It is kept outside JSONata so a
 * formula cannot reach it: bindings are JSONata variables, and a formula can
 * shadow any variable with `:=`, which would disable the timeout.
 */
const evaluations = new AsyncLocalStorage<Evaluation | undefined>();

function checkDeadline(): void {
	const deadline = evaluations.getStore()?.deadline;
	if (deadline && Date.now() > deadline.at) {
		throw new FormulaTimeoutError(deadline.timeout);
	}
}

type FlaggedArray = unknown[] & { sequence?: unknown; keepSingleton?: unknown };

/**
 * Keeps JSONata from leaving a flag on arrays it did not create.
 *
 * A path that ends in `[]` (`tags[]`) sets an enumerable `keepSingleton` flag
 * on its result. When that result is an array taken as is from the payload or
 * a binding, the flag lands on the caller's array: it shows up in
 * `Object.keys`, deep equality checks and other rules' results, and stays on
 * module default bindings for every later run. JSONata only reads the flag on
 * the sequences it builds (`sequence: true`), so removing it from any other
 * array changes no result.
 *
 * This hook runs after every node, so it removes the flag as soon as the path
 * returns the array. A path with a grouping (`lines[]{...}`) returns the group
 * instead, so for those formulas the arrays the hook sees are recorded and
 * `removeForeignFlags()` cleans them when the evaluation ends.
 */
function removeForeignFlag(
	_expr: unknown,
	_input: unknown,
	_environment: unknown,
	result: unknown,
): void {
	if (!Array.isArray(result) || (result as FlaggedArray).sequence) {
		return;
	}
	if (Object.prototype.hasOwnProperty.call(result, 'keepSingleton')) {
		delete (result as FlaggedArray).keepSingleton;
	}
	evaluations.getStore()?.foreignArrays?.add(result);
}

function removeForeignFlags(foreignArrays: Set<unknown[]>): void {
	for (const array of foreignArrays) {
		delete (array as FlaggedArray).keepSingleton;
	}
}

/** How much clean-up a parsed formula needs, see `removeForeignFlag()`. */
type FlagCleanup = 'none' | 'node' | 'evaluation';

/**
 * Only paths ending in `[]` make JSONata flag arrays. Formulas without one get
 * no exit hook (JSONata awaits it after every node), and only those with a
 * grouping on such a path need a per-evaluation store (Node propagates an
 * undefined store about twice as fast through JSONata's promises).
 */
function flagCleanup(ast: unknown): FlagCleanup {
	const seen = new Set<object>();
	let hasPath = false;
	const visit = (node: unknown): boolean => {
		if (node === null || typeof node !== 'object' || seen.has(node)) {
			return false;
		}
		seen.add(node);
		const n = node as Record<string, unknown>;
		if (n.keepSingletonArray === true) {
			if (n.group !== undefined) {
				return true;
			}
			hasPath = true;
		}
		return Object.values(n).some(visit);
	};
	if (visit(ast)) {
		return 'evaluation';
	}
	return hasPath ? 'node' : 'none';
}

/** Compiled formulas whose clean-up is `evaluation`. */
const needsEvaluationCleanup = new WeakSet<jsonata.Expression>();

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
		const cleanup = flagCleanup(expression.ast());
		if (cleanup !== 'none') {
			expression.assign(EVALUATE_EXIT as unknown as string, removeForeignFlag);
		}
		if (cleanup === 'evaluation') {
			needsEvaluationCleanup.add(expression);
		}
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
		const deadline = timeout
			? { at: Date.now() + timeout, timeout }
			: undefined;
		const foreignArrays = needsEvaluationCleanup.has(expression)
			? new Set<unknown[]>()
			: undefined;
		// The store is left undefined when it is not needed, which is faster.
		// It is always set, so a nested evaluation (for example from a binding
		// function) does not inherit the outer deadline or arrays.
		const evaluation: Evaluation | undefined =
			deadline || foreignArrays ? { deadline, foreignArrays } : undefined;
		const result = evaluations.run(evaluation, () =>
			expression.evaluate(input, bindings),
		);
		return foreignArrays
			? result.finally(() => removeForeignFlags(foreignArrays))
			: result;
	}
}
