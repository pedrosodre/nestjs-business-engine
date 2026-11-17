import { BusinessEngineService, Rule } from '../../lib';

const rule = (overrides: Partial<Rule> = {}): Rule => ({
	id: 'r1',
	group: 'g',
	transform: [{ key: 'double', formula: 'value * 2' }],
	when: { double: { $gt: 10 } },
	produce: { default: 0, formula: 'double + 1' },
	...overrides,
});

describe('debug trace', () => {
	it('returns the trace of every step when debug is enabled', async () => {
		const service = new BusinessEngineService();
		const { results, debug } = await service.run([rule()], { value: 6 }, true);

		expect(results).toEqual({ r1: 13 });
		expect(debug?.map(step => step.message)).toEqual([
			'Starting the business engine',
			'Running a single rule',
			'Transforming initial payload',
			'Evaluating a rule',
			'Producing the result',
			'Returning all results',
		]);
	});

	it('does not return a trace when debug is disabled', async () => {
		const service = new BusinessEngineService();
		const output = await service.run([rule()], { value: 6 });

		expect(output).not.toHaveProperty('debug');
	});

	it('keeps no state in the service after a failed debug run', async () => {
		const service = new BusinessEngineService();

		await expect(
			service.run([rule({ produce: { formula: '1 +' } })], { value: 6 }, true),
		).rejects.toThrow();

		const leftovers = (service as any).debugSteps ?? {};
		expect(Object.keys(leftovers)).toHaveLength(0);
	});
});
