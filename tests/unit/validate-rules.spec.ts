import {
	BusinessEngineService,
	InvalidRuleError,
	rulesSchema,
	validateRules,
} from '../../lib';

describe('validateRules()', () => {
	const valid = [
		{
			id: 'discount',
			group: 'pricing',
			transform: [{ key: 'total', formula: '$sum(items.price)' }],
			when: { total: { $gt: 100 } },
			produce: { default: 0, formula: 'total * 0.1' },
		},
		{ id: 'flag', produce: { formula: 'true' } },
	];

	it('returns no issues for valid rules', () => {
		expect(validateRules(valid)).toEqual([]);
	});

	it('rejects a value that is not an array', () => {
		expect(validateRules({})).toEqual([{ message: 'Rules must be an array', path: [] }]);
	});

	it('reports structural problems with their path', () => {
		const issues = validateRules([
			null,
			{ produce: { formula: '1' } },
			{ id: 'r', group: 1, enabled: 'yes', transform: {}, when: [], produce: 'x' },
			{ id: 't', transform: [null, { formula: 1 }], produce: { formula: '1' } },
		]);

		expect(issues.map(issue => [issue.path, issue.message])).toEqual([
			[[0], 'Rule at index 0 must be an object'],
			[[1, 'id'], 'Rule at index 1 must have a non-empty string id'],
			[[2, 'group'], 'Rule "r": group must be a string'],
			[[2, 'enabled'], 'Rule "r": enabled must be a boolean'],
			[[2, 'transform'], 'Rule "r": transform must be an array'],
			[[2, 'when'], 'Rule "r": when must be an object'],
			[[2, 'produce'], 'Rule "r" must have a produce object'],
			[[3, 'transform', 0], 'Rule "t": transform 0 must be an object'],
			[[3, 'transform', 1, 'key'], 'Rule "t": transform 1 must have a non-empty string key'],
			[[3, 'transform', 1, 'formula'], 'Rule "t": transform 1 formula must be a string'],
		]);
	});

	it('reports invalid formulas, unsafe keys, duplicates and $where', () => {
		const issues = validateRules([
			{ id: 'a', transform: [{ key: '__proto__', formula: '1 +' }], produce: { formula: '1' } },
			{ id: 'a', when: { x: { $elemMatch: { $where: 'true' } } }, produce: { formula: '(' } },
		]);

		expect(issues).toEqual([
			{ ruleId: 'a', path: [0, 'transform', 0, 'key'], message: 'Rule "a" uses the forbidden transform key "__proto__"' },
			{
				ruleId: 'a',
				path: [0, 'transform', 0, 'formula'],
				message: 'Rule "a": transform 0 formula is invalid at position 3: Unexpected end of expression',
			},
			{ ruleId: 'a', path: [1, 'id'], message: 'Duplicate rule id "a"' },
			{ ruleId: 'a', path: [1, 'when'], message: 'Rule "a": the $where operator is not supported' },
			{
				ruleId: 'a',
				path: [1, 'produce', 'formula'],
				message: expect.stringContaining('Rule "a": produce formula is invalid'),
			},
		]);
	});

	it('is available on the service', () => {
		expect(new BusinessEngineService().validate(valid)).toEqual([]);
	});
});

describe('rulesSchema', () => {
	it('implements Standard Schema v1', async () => {
		const standard = rulesSchema['~standard'];
		expect(standard.version).toBe(1);
		expect(standard.vendor).toBe('nestjs-business-engine');

		const rules = [{ id: 'a', produce: { formula: '1' } }];
		expect(await standard.validate(rules)).toEqual({ value: rules });

		const failure = await standard.validate([{ id: 'a' }]);
		expect(failure.issues?.[0].message).toBe('Rule "a" must have a produce object');
	});
});

describe('run() validation', () => {
	const service = new BusinessEngineService();

	it('rejects malformed rules with every issue', async () => {
		const error = await service
			.run([{ id: '' }, { id: 'b' }] as never, {})
			.catch(e => e);

		expect(error).toBeInstanceOf(InvalidRuleError);
		expect(error.issues).toHaveLength(3);
		expect(error.message).toBe(
			'Rule at index 0 must have a non-empty string id (and 2 more issues)',
		);
	});
});
