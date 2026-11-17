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
});
