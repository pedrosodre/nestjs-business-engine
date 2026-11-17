import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BusinessEngineModule, BusinessEngineService } from '../../lib';

const rules = [
	{ id: 'gross', produce: { formula: '$round(net * (1 + $vat), 2)' } },
];

@Injectable()
class TaxService {
	readonly vat = 0.25;
}

@Module({ providers: [TaxService], exports: [TaxService] })
class TaxModule {}

describe('BusinessEngineModule', () => {
	it('provides the service with defaults when imported as is', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [BusinessEngineModule],
		}).compile();

		const service = moduleRef.get(BusinessEngineService);
		const { results } = await service.run(rules, { net: 10 }, { bindings: { vat: 0.1 } });

		expect(results).toEqual({ gross: 11 });
	});

	it('applies forRoot() defaults, overridable per run', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				BusinessEngineModule.forRoot({
					bindings: { vat: 0.2 },
					continueOnError: true,
					timeout: 1000,
				}),
			],
		}).compile();
		const service = moduleRef.get(BusinessEngineService);

		expect((await service.run(rules, { net: 10 })).results).toEqual({ gross: 12 });
		expect(
			(await service.run(rules, { net: 10 }, { bindings: { vat: 0.5 } })).results,
		).toEqual({ gross: 15 });

		const broken = [{ id: 'broken', produce: { default: 0, formula: '$nope()' } }];
		const { errors } = await service.run(broken, {});
		expect(errors).toHaveLength(1);
		await expect(
			service.run(broken, {}, { continueOnError: false }),
		).rejects.toThrow('broken');
	});

	it('builds the options with forRootAsync() and injected providers', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				BusinessEngineModule.forRootAsync({
					imports: [TaxModule],
					inject: [TaxService],
					useFactory: async (tax: TaxService) => ({ bindings: { vat: tax.vat } }),
				}),
			],
		}).compile();

		const { results } = await moduleRef.get(BusinessEngineService).run(rules, { net: 10 });
		expect(results).toEqual({ gross: 12.5 });
	});

	it('registers a global module with isGlobal', async () => {
		@Injectable()
		class Consumer {
			constructor(readonly engine: BusinessEngineService) {}
		}

		@Module({ providers: [Consumer] })
		class FeatureModule {}

		const moduleRef = await Test.createTestingModule({
			imports: [BusinessEngineModule.forRoot({ isGlobal: true }), FeatureModule],
		}).compile();

		expect(moduleRef.get(Consumer).engine).toBeInstanceOf(BusinessEngineService);
	});
});
