import {
	BusinessEngineError,
	BusinessEngineService,
	InvalidRuleError,
	Rule,
} from '../../lib';

const rule = (overrides: Partial<Rule> = {}): Rule => ({
	id: 'r1',
	group: 'g',
	transform: [],
	when: {},
	produce: { formula: '1' },
	...overrides,
});

describe('rule validation', () => {
	const service = new BusinessEngineService();

	it.each(['__proto__', 'constructor', 'prototype'])(
		'rejects the transform key %s',
		async key => {
			const rules = [
				rule({
					transform: [{ key, formula: '{ "isAdmin": true }' }],
					when: { isAdmin: true },
				}),
			];

			const error = await service.run(rules, {}).catch(e => e);

			expect(error).toBeInstanceOf(InvalidRuleError);
			expect(error).toBeInstanceOf(BusinessEngineError);
			expect(error.ruleId).toBe('r1');
		},
	);

	it('rejects the rule id __proto__', async () => {
		const error = await service
			.run([rule({ id: '__proto__' })], {})
			.catch(e => e);

		expect(error).toBeInstanceOf(InvalidRuleError);
		expect(({} as any).isAdmin).toBeUndefined();
	});
});
