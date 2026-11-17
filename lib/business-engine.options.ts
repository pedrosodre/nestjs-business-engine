import type {
	InjectionToken,
	ModuleMetadata,
	OptionalFactoryDependency,
} from '@nestjs/common';

/** Injection token of the module options. */
export const BUSINESS_ENGINE_OPTIONS = 'BUSINESS_ENGINE_OPTIONS';

/** Defaults applied to every `run()` of the service. */
export interface BusinessEngineOptions {
	/**
	 * Variables and functions available to every formula as `$name`. Merged
	 * with (and overridden by) `RunOptions.bindings`.
	 */
	bindings?: Record<string, unknown>;
	/** Default `RunOptions.timeout`, in milliseconds. */
	timeout?: number;
	/** Default `RunOptions.continueOnError`. */
	continueOnError?: boolean;
	/** Number of compiled formulas kept in memory (LRU). `0` disables the cache. Defaults to 500. */
	cacheSize?: number;
}

/** Options of `BusinessEngineModule.forRoot()`. */
export interface BusinessEngineModuleOptions extends BusinessEngineOptions {
	/** Register the module globally. Defaults to `false`. */
	isGlobal?: boolean;
}

/** Options of `BusinessEngineModule.forRootAsync()`. */
export interface BusinessEngineModuleAsyncOptions extends Pick<
	ModuleMetadata,
	'imports'
> {
	/** Register the module globally. Defaults to `false`. */
	isGlobal?: boolean;
	/** Providers injected into `useFactory`. */
	inject?: Array<InjectionToken | OptionalFactoryDependency>;
	/** Returns the options, possibly asynchronously. */
	useFactory: (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Nest's FactoryProvider
		...args: any[]
	) => BusinessEngineOptions | Promise<BusinessEngineOptions>;
}
