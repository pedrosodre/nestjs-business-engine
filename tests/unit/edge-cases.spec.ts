import { Test } from '@nestjs/testing';
import {
	BusinessEngineModule,
	BusinessEngineService,
	InvalidRuleError,
	RuleEvaluationError,
} from '../../lib';
import { toPlainValue } from '../../lib/util/normalize.util';

describe('RuleEvaluationError', () => {
	it('describes causes that are not objects', () => {
		const error = new RuleEvaluationError('r1', 'when', 'boom');
		expect(error.message).toBe('Rule "r1" failed at when: boom');
		expect(error.code).toBeUndefined();
	});

	it('includes the code without a position', () => {
		const error = new RuleEvaluationError('r1', 'produce', {
			code: 'X1',
			message: 'bad',
		});
		expect(error.message).toBe('Rule "r1" failed at produce: bad (X1)');
	});

	it('stringifies objects without a message', () => {
		const error = new RuleEvaluationError('r1', 'produce', {});
		expect(error.message).toBe('Rule "r1" failed at produce: [object Object]');
	});
});

describe('InvalidRuleError', () => {
	it('has a generic message without issues', () => {
		const error = new InvalidRuleError([]);
		expect(error.message).toBe('Invalid rules');
		expect(error.ruleId).toBeUndefined();
	});
});

describe('toPlainValue()', () => {
	it('keeps class instances and dates untouched', () => {
		const date = new Date();
		const map = new Map();
		expect(toPlainValue(date)).toBe(date);
		expect(toPlainValue({ map }).map).toBe(map);
	});

	it('supports objects without a prototype', () => {
		const value = Object.assign(Object.create(null), { a: 1 });
		expect(toPlainValue(value)).toBe(value);
	});

	it('keeps shared references consistent', () => {
		const shared = Object.assign([1], { sequence: true });
		const result = toPlainValue({ a: shared, b: shared });
		expect(result.a).toBe(result.b);
		expect(Object.keys(result.a)).toEqual(['0']);
	});
});

describe('module and service defaults', () => {
	it('builds forRootAsync() without imports or inject', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				BusinessEngineModule.forRootAsync({
					useFactory: () => ({ timeout: 100 }),
				}),
			],
		}).compile();

		expect(moduleRef.get(BusinessEngineService)).toBeInstanceOf(
			BusinessEngineService,
		);
	});

	it('builds forRoot() without options', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [BusinessEngineModule.forRoot()],
		}).compile();

		expect(moduleRef.get(BusinessEngineService)).toBeInstanceOf(
			BusinessEngineService,
		);
	});

	it('records failed rules in the debug trace', async () => {
		const service = new BusinessEngineService();
		const { debug } = await service.run(
			[{ id: 'r', produce: { default: 0, formula: '$nope()' } }],
			{},
			{ continueOnError: true, debug: true },
		);

		expect(debug).toContainEqual({
			message: 'Rule failed, keeping its default',
			context: { ruleId: 'r', error: expect.stringContaining('T1006') },
		});
	});
});
