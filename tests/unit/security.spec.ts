import { RuleEvaluationError, validateRules } from '../../lib';
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
			when: {
				a: {
					$elemMatch: { $where: '(globalThis.__businessEnginePwned = true)' },
				},
			},
			produce: { formula: '1' },
		};

		await expect(service.run([rule], { a: [{}] })).rejects.toThrow(/\$where/);
		expect((globalThis as any).__businessEnginePwned).toBeUndefined();
	});
});

describe('formula security', () => {
	const identity = 'function($o){ $o }';

	it.each([
		[
			'an assignment',
			`( $clone := ${identity}; $.customer ~> | $ | {"role": "admin"} | )`,
		],
		[
			'a lambda parameter',
			`(function($clone){ $.customer ~> | $ | {"role": "admin"} | })(${identity})`,
		],
		[
			'$eval',
			`$eval('( $clone := ${identity}; $.customer ~> | $ | {"role": "admin"} | )', $)`,
		],
		['a focus variable', 'customer@$clone.role'],
		['an index variable', 'customer#$clone.role'],
	])(
		'rejects a formula that rebinds $clone through %s',
		async (_name, formula) => {
			const config = { maxDiscount: 10 };
			const service = new BusinessEngineService({ bindings: { config } });
			const payload = { customer: { role: 'user' } };
			const rules = [
				{ id: 'evil', produce: { formula } },
				{
					id: 'victim',
					when: { 'customer.role': 'admin' },
					produce: { formula: '"granted"', default: 'denied' },
				},
			];

			expect(validateRules(rules)).toEqual([
				expect.objectContaining({ path: [0, 'produce', 'formula'] }),
			]);
			const { results, errors } = await service.run(rules, payload, {
				continueOnError: true,
			});

			expect(errors[0]).toBeInstanceOf(RuleEvaluationError);
			expect(errors[0].code).toBe('UNSAFE_FORMULA');
			expect(results.victim).toBe('denied');
			expect(payload).toEqual({ customer: { role: 'user' } });
			expect(config).toEqual({ maxDiscount: 10 });
		},
	);

	it('cannot mutate module default bindings through the transform operator', async () => {
		const config = { maxDiscount: 10 };
		const service = new BusinessEngineService({ bindings: { config } });

		await service
			.run(
				[
					{
						id: 'evil',
						produce: {
							formula: `( $clone := ${identity}; $config ~> | $ | {"maxDiscount": 100} | )`,
						},
					},
				],
				{},
			)
			.catch(() => undefined);
		const { results } = await service.run(
			[{ id: 'limit', produce: { formula: '$config.maxDiscount' } }],
			{},
		);

		expect(results).toEqual({ limit: 10 });
	});

	it('still allows the transform operator and calling $clone', async () => {
		const service = new BusinessEngineService();
		const payload = { customer: { role: 'user' } };

		const { results } = await service.run(
			[
				{
					id: 'updated',
					produce: { formula: '$.customer ~> | $ | {"role": "admin"} |' },
				},
				{ id: 'copy', produce: { formula: '$clone(customer)' } },
			],
			payload,
		);

		expect(results).toEqual({
			updated: { role: 'admin' },
			copy: { role: 'user' },
		});
		expect(payload).toEqual({ customer: { role: 'user' } });
	});
});

describe('formulas ending in []', () => {
	it.each([
		['the payload', 'tags[]'],
		['a nested payload array', 'order.lines[]'],
		['a path with a filter', 'tags[$ != ""][]'],
		['a path inside an object', '{"t": tags[]}'],
		['a path with a grouping', 'order.lines[]{"n": $count($)}'],
		[
			'a path with a grouping followed by another path',
			'( $g := order.lines[]{"n": 1}; tags[] )',
		],
		['a path inside a lambda', '$map([1], function($v){ tags[] })'],
	])('do not add properties to %s (%s)', async (_name, formula) => {
		const payload = { tags: ['vip'], order: { lines: [{ sku: 'a' }] } };
		const service = new BusinessEngineService();

		await service.run([{ id: 'r', produce: { formula } }], payload);

		expect(Object.keys(payload.tags)).toEqual(['0']);
		expect(Object.keys(payload.order.lines)).toEqual(['0']);
	});

	it('do not add properties to module default bindings', async () => {
		const config = { levels: ['gold'] };
		const service = new BusinessEngineService({ bindings: { config } });

		await service.run(
			[{ id: 'r', produce: { formula: '$config.levels[]' } }],
			{},
		);

		expect(Object.keys(config.levels)).toEqual(['0']);
	});

	it('do not leak flags into the results of other rules', async () => {
		const service = new BusinessEngineService();

		const { results } = await service.run(
			[
				{ id: 'tags', produce: { formula: 'tags' } },
				{ id: 'forced', produce: { formula: 'tags[]' } },
			],
			{ tags: ['vip'] },
		);

		expect(Object.keys(results.tags as string[])).toEqual(['0']);
		expect(Object.keys(results.forced as string[])).toEqual(['0']);
	});

	it('do not add properties when the formula fails afterwards', async () => {
		const payload = { lines: [{ sku: 'a' }] };
		const service = new BusinessEngineService();

		const { errors } = await service.run(
			[
				{
					id: 'r',
					produce: { formula: '( $g := lines[]{"n": 1}; $error("boom") )' },
				},
			],
			payload,
			{ continueOnError: true },
		);

		expect(errors).toHaveLength(1);
		expect(Object.keys(payload.lines)).toEqual(['0']);
	});

	it('still keep single values as arrays', async () => {
		const service = new BusinessEngineService();

		const { results } = await service.run(
			[
				{ id: 'raw', produce: { formula: 'tags[]' } },
				{ id: 'mapped', produce: { formula: 'lines.sku[]' } },
				{ id: 'unwrapped', produce: { formula: 'lines.sku' } },
			],
			{ tags: ['vip'], lines: [{ sku: 'a' }] },
		);

		expect(results).toEqual({ raw: ['vip'], mapped: ['a'], unwrapped: 'a' });
	});
});
