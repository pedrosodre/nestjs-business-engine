import jsonata from 'jsonata';

/** Default number of compiled formulas kept in memory. */
export const DEFAULT_FORMULA_CACHE_SIZE = 500;

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
		if (this.maxSize > 0) {
			if (this.entries.size >= this.maxSize) {
				const oldest = this.entries.keys().next().value as string;
				this.entries.delete(oldest);
			}
			this.entries.set(formula, expression);
		}
		return expression;
	}
}
