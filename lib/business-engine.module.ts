import { DynamicModule, Module } from '@nestjs/common';
import {
	BUSINESS_ENGINE_OPTIONS,
	BusinessEngineModuleAsyncOptions,
	BusinessEngineModuleOptions,
} from './business-engine.options';
import { BusinessEngineService } from './business-engine.service';

/**
 * Provides `BusinessEngineService`. Import it as is for the defaults, or with
 * `forRoot()` / `forRootAsync()` to configure every run.
 */
@Module({
	providers: [BusinessEngineService],
	exports: [BusinessEngineService],
})
export class BusinessEngineModule {
	static forRoot(options: BusinessEngineModuleOptions = {}): DynamicModule {
		const { isGlobal, ...engineOptions } = options;
		return {
			module: BusinessEngineModule,
			global: isGlobal,
			providers: [
				{ provide: BUSINESS_ENGINE_OPTIONS, useValue: engineOptions },
				BusinessEngineService,
			],
			exports: [BusinessEngineService],
		};
	}

	static forRootAsync(options: BusinessEngineModuleAsyncOptions): DynamicModule {
		return {
			module: BusinessEngineModule,
			global: options.isGlobal,
			imports: options.imports ?? [],
			providers: [
				{
					provide: BUSINESS_ENGINE_OPTIONS,
					useFactory: options.useFactory,
					inject: options.inject ?? [],
				},
				BusinessEngineService,
			],
			exports: [BusinessEngineService],
		};
	}
}
