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
