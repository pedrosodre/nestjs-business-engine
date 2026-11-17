// Runtime smoke test of the CommonJS build (dist/) against the installed NestJS.
// Run with `npm run test:compat` after `npm run build`.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Injectable, Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const {
	BusinessEngineModule,
	BusinessEngineService,
	InvalidRuleError,
	RuleEvaluationError,
	rulesSchema,
	validateRules,
} = require('../../dist/index.js');

const rules = [
	{
		id: 'discount',
		group: 'pricing',
		transform: [{ key: 'total', formula: '$sum(items.price)' }],
		when: { total: { $gt: 100 } },
		produce: { default: 0, formula: '$round(total * $rate, 2)' },
	},
	{ id: 'shipping', group: 'shipping', produce: { formula: '5' } },
];

class TaxService {
	constructor() {
		this.rate = 0.1;
	}
}
Injectable()(TaxService);

class TaxModule {}
Module({ providers: [TaxService], exports: [TaxService] })(TaxModule);

class AppModule {}
Module({
	imports: [
		BusinessEngineModule.forRootAsync({
			isGlobal: true,
			imports: [TaxModule],
			inject: [TaxService],
			useFactory: tax => ({ bindings: { rate: tax.rate }, timeout: 1000 }),
		}),
	],
})(AppModule);

async function main() {
	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: false,
	});
	const engine = app.get(BusinessEngineService);

	const { results, matched, errors } = await engine.run(
		rules,
		{ items: [{ price: 80 }, { price: 40 }] },
		{ group: 'pricing' },
	);
	assert.deepEqual(results, { discount: 12 });
	assert.deepEqual(matched, ['discount']);
	assert.deepEqual(errors, []);

	await assert.rejects(
		engine.run([{ id: 'x', produce: { formula: '1 +' } }], {}),
		RuleEvaluationError,
	);
	await assert.rejects(
		engine.run([{ id: '__proto__', produce: { formula: '1' } }], {}),
		InvalidRuleError,
	);
	await assert.rejects(
		engine.run(
			[
				{
					id: 'loop',
					produce: { formula: '( $f := function($n) { $f($n + 1) }; $f(0) )' },
				},
			],
			{},
			{ timeout: 20 },
		),
		error => error.code === 'TIMEOUT',
	);

	assert.deepEqual(validateRules(rules), []);
	assert.equal(rulesSchema['~standard'].version, 1);

	await app.close();
	const nest = require('@nestjs/core/package.json').version;
	console.log(`CJS runtime OK with @nestjs/core ${nest}`);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
