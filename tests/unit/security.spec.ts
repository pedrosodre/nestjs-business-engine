import { BusinessEngineService } from '../../lib/business-engine.service';

describe('condition security', () => {
	const service = new BusinessEngineService();

	afterEach(() => {
		delete (globalThis as any).__businessEnginePwned;
	});

	it('does not execute JavaScript from a string $where condition', async () => {
		const rule = {
			id: 'evil',
			group: 'g',
			transform: [],
			when: { $where: '(globalThis.__businessEnginePwned = true)' },
			produce: { formula: '1' },
		};

		await expect(service.run([rule], {})).rejects.toThrow(/\$where/);
		expect((globalThis as any).__businessEnginePwned).toBeUndefined();
	});

	it('rejects a nested $where condition', async () => {
		const rule = {
			id: 'evil',
			group: 'g',
			transform: [],
			when: { a: { $elemMatch: { $where: '(globalThis.__businessEnginePwned = true)' } } },
			produce: { formula: '1' },
		};

		await expect(service.run([rule], { a: [{}] })).rejects.toThrow(/\$where/);
		expect((globalThis as any).__businessEnginePwned).toBeUndefined();
	});
});
