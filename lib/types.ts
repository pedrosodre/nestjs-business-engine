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
