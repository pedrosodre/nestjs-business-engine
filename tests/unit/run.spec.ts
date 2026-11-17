import { BusinessEngineService } from '../../lib';

describe('run()', () => {
	const service = new BusinessEngineService();

	it('accepts rules without transform or when', async () => {
		const rules = [{ id: 'always', group: 'g', produce: { formula: 'a + 1' } }];

		const { results } = await service.run(rules, { a: 1 });

		expect(results).toEqual({ always: 2 });
	});
});
