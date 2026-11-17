import { FormulaCache } from '../../lib/util/formula.util';

describe('FormulaCache', () => {
	it('reuses the compiled formula', () => {
		const cache = new FormulaCache();
		expect(cache.compile('a + 1')).toBe(cache.compile('a + 1'));
		expect(cache.size).toBe(1);
	});

	it('evicts the least recently used formula', () => {
		const cache = new FormulaCache(2);
		const first = cache.compile('1');
		cache.compile('2');
		cache.compile('1'); // refresh "1"
		cache.compile('3'); // evicts "2"

		expect(cache.size).toBe(2);
		expect(cache.compile('1')).toBe(first);
	});

	it('does not cache when the size is 0', () => {
		const cache = new FormulaCache(0);
		expect(cache.compile('1')).not.toBe(cache.compile('1'));
		expect(cache.size).toBe(0);
	});

	it('does not cache invalid formulas', () => {
		const cache = new FormulaCache();
		expect(() => cache.compile('1 +')).toThrow();
		expect(cache.size).toBe(0);
	});
});
