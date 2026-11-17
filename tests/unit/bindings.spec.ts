import { BusinessEngineService } from '../../lib';

describe('bindings', () => {
	const service = new BusinessEngineService();

	it('exposes variables and functions to transform and produce formulas', async () => {
		const { results } = await service.run(
			[
				{
					id: 'gross',
					transform: [{ key: 'gross', formula: 'net * (1 + $vat)' }],
					when: { gross: { $gt: 100 } },
					produce: { formula: '$round2(gross)' },
				},
			],
			{ net: 100.004 },
			{
				bindings: {
					vat: 0.2,
					round2: (value: number) => Math.round(value * 100) / 100,
				},
			},
		);

		expect(results).toEqual({ gross: 120 });
	});

	it('supports async functions', async () => {
		const { results } = await service.run(
			[{ id: 'rate', produce: { formula: '$lookupRate(currency)' } }],
			{ currency: 'EUR' },
			{
				bindings: {
					lookupRate: async (code: string) => (code === 'EUR' ? 1.1 : 1),
				},
			},
		);

		expect(results).toEqual({ rate: 1.1 });
	});
});
