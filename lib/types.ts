export type RuleTransform = {
	key: string;
	formula: string;
};

export type RuleProduce = {
	default?: unknown;
	formula: string;
};

export type Rule = {
	id: string;
	group: string;
	transform: Array<RuleTransform>;
	when: Record<string, unknown>;
	produce: RuleProduce;
};

/** One entry of the debug trace returned by `run()` when debug is enabled. */
export type DebugStep = {
	message: string;
	context: Record<string, unknown>;
};
