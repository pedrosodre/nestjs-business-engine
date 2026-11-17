import {
	BusinessEngineError,
	BusinessEngineService,
	RuleEvaluationError,
	Rule,
} from '../../lib';

const rule = (overrides: Partial<Rule>): Rule => ({
	id: 'r1',
	group: 'g',
	transform: [],
	when: {},
	produce: { formula: '1' },
	...overrides,
});

describe('errors', () => {
	const service = new BusinessEngineService();

	it('wraps an invalid transform formula in a RuleEvaluationError', async () => {
		const error = await service
			.run([rule({ transform: [{ key: 'total', formula: '1 +' }] })], {})
			.catch(e => e);

		expect(error).toBeInstanceOf(RuleEvaluationError);
		expect(error).toBeInstanceOf(BusinessEngineError);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('RuleEvaluationError');
		expect(error.ruleId).toBe('r1');
		expect(error.stage).toBe('transform');
		expect(error.key).toBe('total');
		expect(error.code).toBe('S0207');
		expect(error.cause).toMatchObject({ code: 'S0207' });
		expect(error.message).toContain('Rule "r1"');
		expect(error.message).toContain('Unexpected end of expression');
	});

	it('wraps a runtime produce failure', async () => {
		const error = await service
			.run([rule({ produce: { formula: '$unknownFunction()' } })], {})
			.catch(e => e);

		expect(error).toBeInstanceOf(RuleEvaluationError);
		expect(error.stage).toBe('produce');
		expect(error.code).toBe('T1006');
	});

	it('wraps a condition failure', async () => {
		const error = await service
			.run([rule({ when: { a: { $unknownOperator: 1 } } })], { a: 1 })
			.catch(e => e);

		expect(error).toBeInstanceOf(RuleEvaluationError);
		expect(error.stage).toBe('when');
		expect(error.cause).toBeInstanceOf(Error);
	});

	describe('continueOnError', () => {
		const rules = [
			rule({
				id: 'broken',
				produce: { default: -1, formula: '$unknownFunction()' },
			}),
			rule({ id: 'fine', produce: { formula: '42' } }),
		];

		it('rejects the run by default', async () => {
			await expect(service.run(rules, {})).rejects.toBeInstanceOf(
				RuleEvaluationError,
			);
		});

		it('keeps the default of failed rules and reports their errors', async () => {
			const { results, matched, errors } = await service.run(
				rules,
				{},
				{
					continueOnError: true,
				},
			);

			expect(results).toEqual({ broken: -1, fine: 42 });
			expect(matched).toEqual(['fine']);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toBeInstanceOf(RuleEvaluationError);
			expect(errors[0].ruleId).toBe('broken');
		});

		it('still rejects invalid rules', async () => {
			await expect(
				service.run([rule({ id: '__proto__' })], {}, { continueOnError: true }),
			).rejects.toThrow('not allowed');
		});

		it('returns an empty error list when nothing fails', async () => {
			const { errors } = await service.run([rule({})], {});
			expect(errors).toEqual([]);
		});
	});
});
