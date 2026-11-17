import { BusinessEngineService } from '../../lib';

describe('run()', () => {
	const service = new BusinessEngineService();

	it('accepts rules without transform or when', async () => {
		const rules = [{ id: 'always', group: 'g', produce: { formula: 'a + 1' } }];

		const { results } = await service.run(rules, { a: 1 });

		expect(results).toEqual({ always: 2 });
	});

	it('uses the default when the produce formula yields nothing', async () => {
		const rules = [
			{ id: 'r1', group: 'g', produce: { default: 0, formula: 'missing.field' } },
		];

		const { results } = await service.run(rules, {});

		expect(results).toEqual({ r1: 0 });
	});

	it('returns plain arrays without JSONata sequence flags', async () => {
		const rules = [
			{
				id: 'r1',
				group: 'g',
				transform: [{ key: 'prices', formula: 'items.price' }],
				produce: { formula: '{ "prices": prices, "doubled": prices.($ * 2) }' },
			},
		];

		const { results } = await service.run(rules, {
			items: [{ price: 1 }, { price: 2 }],
		});

		expect(results).toStrictEqual({ r1: { prices: [1, 2], doubled: [2, 4] } });
		const output = results.r1 as { prices: number[] };
		expect(Object.keys(output.prices)).toEqual(['0', '1']);
	});

	it('handles cyclic payloads returned by formulas', async () => {
		const node: Record<string, unknown> = { name: 'root' };
		node.self = node;

		const rules = [{ id: 'r1', group: 'g', produce: { formula: 'node' } }];
		const { results } = await service.run(rules, { node });

		expect(results.r1).toBe(node);
	});
});
