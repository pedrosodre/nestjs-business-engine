import * as api from '../../lib';
import type { Rule, RuleProduce, RuleTransform } from '../../lib';

describe('public API', () => {
	it('exports the module and the service', () => {
		expect(api.BusinessEngineModule).toBeDefined();
		expect(api.BusinessEngineService).toBeDefined();
	});

	it('exports the rule types', () => {
		const transform: RuleTransform = { key: 'total', formula: '$sum(items)' };
		const produce: RuleProduce = { formula: 'total' };
		const rule: Rule = {
			id: 'r1',
			group: 'g',
			transform: [transform],
			when: {},
			produce,
		};
		expect(rule.id).toBe('r1');
	});
});
