import {
	BusinessEngineService,
	FormulaTimeoutError,
	RuleEvaluationError,
} from '../../lib';

const infiniteLoop = '( $loop := function($n) { $loop($n + 1) }; $loop(0) )';
// Bounded so a regression fails the test instead of hanging it. It runs
// far longer than the timeouts used below.
const longLoop =
	'( $loop := function($n) { $n >= 200000 ? $n : $loop($n + 1) }; $loop(0) )';

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

	it.each([
		['null', 'null'],
		['a far-future deadline', '{"at": 9e15, "timeout": 1}'],
	])(
		'cannot be disabled by a formula that rebinds the deadline to %s',
		async (_name, value) => {
			const formula = `( $__businessEngineDeadline := ${value}; ${longLoop} )`;
			const error = await service
				.run(
					[
						{
							id: 'loop',
							transform: [{ key: 'x', formula }],
							produce: { formula },
						},
					],
					{},
					{ timeout: 20 },
				)
				.catch(e => e);

			expect(error).toBeInstanceOf(RuleEvaluationError);
			expect(error.code).toBe('TIMEOUT');
		},
	);

	it('does not expose the deadline to formulas', async () => {
		const { results } = await service.run(
			[
				{
					id: 'peek',
					produce: { default: 'hidden', formula: '$__businessEngineDeadline' },
				},
			],
			{},
			{ timeout: 1000 },
		);
		expect(results).toEqual({ peek: 'hidden' });
	});

	it('does not apply an outer deadline to a nested run without a timeout', async () => {
		let inner: unknown;
		const nested = async () => {
			// Let the outer deadline expire before the nested run starts.
			await new Promise(resolve => setTimeout(resolve, 50));
			inner = (
				await service.run([{ id: 'inner', produce: { formula: '1 + 1' } }], {})
			).results.inner;
			return inner;
		};
		await service.run(
			[{ id: 'outer', produce: { formula: '$nested()' } }],
			{},
			{ timeout: 10, continueOnError: true, bindings: { nested } },
		);
		expect(inner).toBe(2);
	});

	it.each([['100'], [Number.NaN], [-1], [Infinity]])(
		'rejects an invalid timeout (%p) instead of ignoring it',
		async timeout => {
			const rules = [{ id: 'r', produce: { formula: '1' } }];
			await expect(
				service.run(rules, {}, { timeout: timeout as number }),
			).rejects.toThrow(TypeError);
			await expect(
				new BusinessEngineService({ timeout: timeout as number }).run(
					rules,
					{},
				),
			).rejects.toThrow(/timeout must be a non-negative number/);
		},
	);

	it('accepts 0 as no limit', async () => {
		const { results } = await service.run(
			[{ id: 'r', produce: { formula: '1' } }],
			{},
			{ timeout: 0 },
		);
		expect(results).toEqual({ r: 1 });
	});
});
