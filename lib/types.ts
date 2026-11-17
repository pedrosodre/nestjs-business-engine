export type RuleTransform = {
	key: string;
	formula: string;
};

export type RuleProduce = {
	/** Result when the condition does not match or the formula yields nothing. */
	default?: unknown;
	formula: string;
};

export type Rule = {
	id: string;
	group: string;
	/** Derived values computed in order before the condition. Defaults to none. */
	transform?: Array<RuleTransform>;
	/** MongoDB-style condition. Defaults to `{}`, which always matches. */
	when?: Record<string, unknown>;
	produce: RuleProduce;
};

/** One entry of the debug trace returned by `run()` when debug is enabled. */
export type DebugStep = {
	message: string;
	context: Record<string, unknown>;
};
