import { Test, TestingModule } from '@nestjs/testing';
import { BusinessEngineService } from './business-engine.service';
import { Rule } from './types';
import { writeFileSync } from 'fs';

describe('BusinessEngineService', () => {
	let service: BusinessEngineService;

	const exampleRules: Array<Rule> = [
		{
			id: 'c8707ab6-e462-4993-9018-97b7bb883ad4',
			group: 'id',
			transform: [
				{
					key: 'totalPrice',
					formula: '$sum(unitPrices.price)',
				},
				{
					key: 'totalAirlinePrice',
					formula: '$sum(thirdPartyOffers[type="airline"].unitPrices.price)',
				},
				// {
				// 	key: 'airlineAdtPercentage',
				// 	formula:
				// 		'1 - (unitPrices[type="ADT"].price / thirdPartyOffers[type="airline"].unitPrices[type="ADT"].price)',
				// },
				// {
				// 	key: 'airlineChdPercentage',
				// 	formula:
				// 		'1 - (unitPrices[type="CHD"].price / thirdPartyOffers[type="airline"].unitPrices[type="CHD"].price)',
				// },
				{
					key: 'airlinePercentage',
					formula: '1 - (totalPrice / totalAirlinePrice)',
				},
				// {
				// 	key: 'unitPrices',
				// 	formula:
				// 		'$map(unitPrices, function($v) {$merge([$v, {"discount": $v.price * 0.05}])})',
				// },
			], // transforma valores brutos em valores refinados
			when: {
				unitPrices: {
					$elemMatch: {
						type: 'ADT',
						price: { $gt: 100 },
					},
				},
				airlinePercentage: { $gt: 0.5 },
			}, // define regras
			produce: {
				default: 0,
				formula: 'totalAirlinePrice * (airlinePercentage / 2)',
			}, // produz resultado
		},
	];

	const examplePayload = {
		unitPrices: [
			{
				type: 'ADT',
				price: 104.4,
			},
			{
				type: 'CHD',
				price: 90.7,
			},
		],
		thirdPartyOffers: [
			{
				type: 'airline',
				unitPrices: [
					{
						type: 'ADT',
						price: 104.4 * 3,
					},
					{
						type: 'CHD',
						price: 90.7 * 3,
					},
				],
			},
		],
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [BusinessEngineService],
		}).compile();

		service = module.get<BusinessEngineService>(BusinessEngineService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	it('run() should produce', async () => {
		const { results, executionId, debug } = await service.run(
			exampleRules,
			examplePayload,
			true,
		);

		writeFileSync(
			'debug.json',
			JSON.stringify({ results, executionId, debug }, null, 2),
		);

		expect(executionId).toBeDefined();
		expect(results).toBeInstanceOf(Object);
		expect(debug).toBeInstanceOf(Array);
	});
});
