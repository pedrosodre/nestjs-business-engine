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

	describe('group option', () => {
		const rules = [
			{ id: 'a', group: 'pricing', produce: { formula: '1' } },
			{ id: 'b', group: 'shipping', produce: { formula: '2' } },
			{ id: 'c', produce: { formula: '3' } },
		];

		it('runs every rule when no group is given', async () => {
			const { results } = await service.run(rules, {});
			expect(results).toEqual({ a: 1, b: 2, c: 3 });
		});

		it('runs only the rules of one group', async () => {
			const { results } = await service.run(rules, {}, { group: 'pricing' });
			expect(results).toEqual({ a: 1 });
		});

		it('runs the rules of several groups', async () => {
			const { results } = await service.run(rules, {}, {
				group: ['pricing', 'shipping'],
			});
			expect(results).toEqual({ a: 1, b: 2 });
		});
	});

	it('types the results with a generic', async () => {
		const { results } = await service.run<{ total: number }>(
			[{ id: 'total', produce: { formula: 'a + b' } }],
			{ a: 1, b: 2 },
		);
		const total: number = results.total;
		expect(total).toBe(3);
	});

	it('generates a unique execution id per run', async () => {
		const first = await service.run([], {});
		const second = await service.run([], {});
		expect(first.executionId).toMatch(/^[0-9a-f-]{36}$/);
		expect(first.executionId).not.toBe(second.executionId);
	});

	it('skips disabled rules', async () => {
		const { results } = await service.run(
			[
				{ id: 'on', produce: { formula: '1' } },
				{ id: 'off', enabled: false, produce: { default: 0, formula: '2' } },
			],
			{},
		);
		expect(results).toEqual({ on: 1 });
	});

	it('lists the rules whose condition matched', async () => {
		const { results, matched } = await service.run(
			[
				{ id: 'big', when: { total: { $gt: 100 } }, produce: { default: false, formula: 'true' } },
				{ id: 'small', when: { total: { $lte: 100 } }, produce: { default: false, formula: 'true' } },
				{ id: 'any', produce: { formula: 'total' } },
			],
			{ total: 50 },
		);
		expect(results).toEqual({ big: false, small: true, any: 50 });
		expect(matched).toEqual(['small', 'any']);
	});

	it('does not share default values between runs', async () => {
		const rules = [
			{
				id: 'tags',
				when: { never: true },
				produce: { default: { list: [] as string[] }, formula: '1' },
			},
		];

		const first = await service.run(rules, {});
		(first.results.tags as { list: string[] }).list.push('mutated');
		const second = await service.run(rules, {});

		expect(second.results).toEqual({ tags: { list: [] } });
		expect(rules[0].produce.default).toEqual({ list: [] });
	});
});
