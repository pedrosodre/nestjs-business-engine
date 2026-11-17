import { BusinessEngineService, Rule, rulesSchema } from '../../lib';

/** Keeps the examples in README.md honest. */
describe('README examples', () => {
	const rules: Rule[] = [
		{
			id: 'vip-discount',
			group: 'pricing',
			transform: [{ key: 'total', formula: '$sum(items.(price * quantity))' }],
			when: { total: { $gte: 100 }, 'customer.tier': 'vip' },
			produce: { default: 0, formula: '$round(total * 0.1, 2)' },
		},
		{
			id: 'free-shipping',
			group: 'shipping',
			when: { 'address.country': { $in: ['PT', 'ES'] } },
			produce: { default: false, formula: 'true' },
		},
	];

	const order = {
		customer: { tier: 'vip' },
		address: { country: 'PT' },
		currency: 'USD',
		items: [
			{ price: 50, quantity: 2 },
			{ price: 25, quantity: 1 },
		],
	};

	const engine = new BusinessEngineService();

	it('getting started', async () => {
		const { results, matched } = await engine.run(rules, order);
		expect(results).toEqual({ 'vip-discount': 12.5, 'free-shipping': true });
		expect(matched).toEqual(['vip-discount', 'free-shipping']);
	});

	it('custom functions', async () => {
		const { results } = await engine.run(
			[
				{
					id: 'price',
					transform: [
						{ key: 'total', formula: '$sum(items.(price * quantity))' },
					],
					produce: { formula: '$round(total * (1 + $vat) * $fx(currency), 2)' },
				},
			],
			order,
			{
				bindings: {
					vat: 0.23,
					fx: async (currency: string) => (currency === 'USD' ? 0.9 : 1),
				},
			},
		);
		expect(results).toEqual({ price: 138.38 });
	});

	it('validation', async () => {
		const result = await rulesSchema['~standard'].validate(rules);
		expect(result.issues).toBeUndefined();
	});
});
