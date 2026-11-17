import { Test } from '@nestjs/testing';
import { BusinessEngineModule, BusinessEngineService, Rule } from '../../lib';

/** The README example: a discount computed from a competitor's offer. */
describe('pricing example', () => {
	const rules: Rule[] = [
		{
			id: 'airline-discount',
			group: 'pricing',
			transform: [
				{ key: 'totalPrice', formula: '$sum(unitPrices.price)' },
				{
					key: 'totalAirlinePrice',
					formula: '$sum(thirdPartyOffers[type="airline"].unitPrices.price)',
				},
				{
					key: 'airlinePercentage',
					formula: '1 - (totalPrice / totalAirlinePrice)',
				},
			],
			when: {
				unitPrices: { $elemMatch: { type: 'ADT', price: { $gt: 100 } } },
				airlinePercentage: { $gt: 0.5 },
			},
			produce: {
				default: 0,
				formula: '$round(totalAirlinePrice * (airlinePercentage / 2), 2)',
			},
		},
	];

	const offer = (adultPrice: number) => ({
		unitPrices: [
			{ type: 'ADT', price: adultPrice },
			{ type: 'CHD', price: 90.7 },
		],
		thirdPartyOffers: [
			{
				type: 'airline',
				unitPrices: [
					{ type: 'ADT', price: 313.2 },
					{ type: 'CHD', price: 272.1 },
				],
			},
		],
	});

	let service: BusinessEngineService;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [BusinessEngineModule],
		}).compile();
		service = moduleRef.get(BusinessEngineService);
	});

	it('produces the discount when the conditions match', async () => {
		const { results, matched } = await service.run(rules, offer(104.4), {
			group: 'pricing',
		});

		expect(results).toEqual({ 'airline-discount': 195.1 });
		expect(matched).toEqual(['airline-discount']);
	});

	it('keeps the default when a condition does not match', async () => {
		const { results, matched } = await service.run(rules, offer(99));

		expect(results).toEqual({ 'airline-discount': 0 });
		expect(matched).toEqual([]);
	});

	it('explains each step in the debug trace', async () => {
		const { debug } = await service.run(rules, offer(104.4), { debug: true });

		const evaluation = debug?.find(
			step => step.message === 'Evaluating a rule',
		);
		expect(evaluation?.context).toMatchObject({
			ruleId: 'airline-discount',
			shouldProduce: true,
		});
		const payload = evaluation?.context.payload as Record<string, number>;
		expect(payload.totalPrice).toBeCloseTo(195.1);
		expect(payload.totalAirlinePrice).toBeCloseTo(585.3);
	});
});
