// Runtime smoke test of the ESM entry (index.mjs) against the installed NestJS.
// Checks that ESM and CJS consumers share one copy of the classes, which Nest's
// dependency injection relies on. Run with `npm run test:compat` after `npm run build`.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
	BusinessEngineModule,
	BusinessEngineService,
	BusinessEngineError,
	validateRules,
} from '../../index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../../dist/index.js');
assert.equal(BusinessEngineService, cjs.BusinessEngineService);
assert.equal(BusinessEngineError, cjs.BusinessEngineError);

class AppModule {}
Module({
	imports: [BusinessEngineModule.forRoot({ bindings: { vat: 0.2 } })],
})(AppModule);

const app = await NestFactory.createApplicationContext(AppModule, {
	logger: false,
});
const engine = app.get(BusinessEngineService);
const { results } = await engine.run(
	[{ id: 'gross', produce: { formula: 'net * (1 + $vat)' } }],
	{ net: 100 },
);
assert.deepEqual(results, { gross: 120 });
assert.equal(validateRules({}).length, 1);
await app.close();

const nest = require('@nestjs/core/package.json').version;
console.log(`ESM runtime OK with @nestjs/core ${nest}`);
