import {
	BusinessEngineService,
	FormulaTimeoutError,
	RuleEvaluationError,
} from '../../lib';

const infiniteLoop = '( $loop := function($n) { $loop($n + 1) }; $loop(0) )';

describe('timeout', () => {
	const service = new BusinessEngineService();

	it('stops a runaway produce formula', async () => {
		const started = Date.now();
		const error = await service
			.run(
				[{ id: 'loop', produce: { formula: infiniteLoop } }],
				{},
				{ timeout: 50 },
			)
			.catch(e => e);

		expect(error).toBeInstanceOf(RuleEvaluationError);
		expect(error.code).toBe('TIMEOUT');
		expect(error.stage).toBe('produce');
		expect(error.cause).toBeInstanceOf(FormulaTimeoutError);
		expect(error.cause.timeout).toBe(50);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it('stops a runaway transform formula', async () => {
		const error = await service
			.run(
				[
					{
						id: 'loop',
						transform: [{ key: 'x', formula: infiniteLoop }],
						produce: { formula: 'x' },
					},
				],
				{},
				{ timeout: 20 },
			)
			.catch(e => e);

		expect(error.code).toBe('TIMEOUT');
		expect(error.stage).toBe('transform');
	});

	it('does not affect formulas that finish in time', async () => {
		const { results } = await service.run(
			[{ id: 'sum', produce: { formula: '$sum([1..1000])' } }],
			{},
			{ timeout: 1000, bindings: { unused: true } },
		);
		expect(results).toEqual({ sum: 500500 });
	});

	it('applies the timeout per run, not per compiled formula', async () => {
		const rules = [
			{ id: 'loop', produce: { default: 'stopped', formula: infiniteLoop } },
		];
		await service.run(rules, {}, { timeout: 10, continueOnError: true });
		const second = await service.run(
			rules,
			{},
			{ timeout: 10, continueOnError: true },
		);
		expect(second.results).toEqual({ loop: 'stopped' });
		expect(second.errors[0].code).toBe('TIMEOUT');
	});
});
