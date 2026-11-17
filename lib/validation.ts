import jsonata from 'jsonata';
import type { StandardSchemaV1 } from './standard-schema';
import type { Rule } from './types';

/** A problem found in a rule set. */
export interface RuleIssue {
	/** Human-readable description. */
	readonly message: string;
	/** Location in the rule set, for example `[0, 'transform', 1, 'formula']`. */
	readonly path: ReadonlyArray<string | number>;
	/** Id of the rule, when it has a valid one. */
	readonly ruleId?: string;
}

/**
 * Keys that would change an object's prototype instead of creating a property.
 * Rule ids and transform keys become property names, so they are rejected.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface CheckOptions {
	/** Also compile formulas and look for `$where` in conditions. */
	deep: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

/** @internal Structural and safety checks shared by run() and validateRules(). */
export function checkRules(rules: unknown, options: CheckOptions): RuleIssue[] {
	if (!Array.isArray(rules)) {
		return [{ message: 'Rules must be an array', path: [] }];
	}

	const issues: RuleIssue[] = [];
	const ids = new Set<string>();

	rules.forEach((rule: unknown, index: number) => {
		if (!isObject(rule)) {
			issues.push({
				message: `Rule at index ${index} must be an object`,
				path: [index],
			});
			return;
		}

		const ruleId = isNonEmptyString(rule.id) ? rule.id : undefined;
		const label =
			ruleId === undefined ? `Rule at index ${index}` : `Rule "${ruleId}"`;
		const add = (message: string, ...path: Array<string | number>) =>
			issues.push({ message, path: [index, ...path], ruleId });

		if (ruleId === undefined) {
			add(`${label} must have a non-empty string id`, 'id');
		} else if (UNSAFE_KEYS.has(ruleId)) {
			add(`Rule id "${ruleId}" is not allowed`, 'id');
		} else if (ids.has(ruleId)) {
			add(`Duplicate rule id "${ruleId}"`, 'id');
		} else {
			ids.add(ruleId);
		}

		if (rule.group !== undefined && typeof rule.group !== 'string') {
			add(`${label}: group must be a string`, 'group');
		}
		if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
			add(`${label}: enabled must be a boolean`, 'enabled');
		}

		if (rule.transform !== undefined) {
			if (!Array.isArray(rule.transform)) {
				add(`${label}: transform must be an array`, 'transform');
			} else {
				rule.transform.forEach((transform: unknown, position: number) => {
					if (!isObject(transform)) {
						add(
							`${label}: transform ${position} must be an object`,
							'transform',
							position,
						);
						return;
					}
					if (!isNonEmptyString(transform.key)) {
						add(
							`${label}: transform ${position} must have a non-empty string key`,
							'transform',
							position,
							'key',
						);
					} else if (UNSAFE_KEYS.has(transform.key)) {
						add(
							`${label} uses the forbidden transform key "${transform.key}"`,
							'transform',
							position,
							'key',
						);
					}
					checkFormula(transform.formula, options, message =>
						add(
							`${label}: transform ${position} ${message}`,
							'transform',
							position,
							'formula',
						),
					);
				});
			}
		}

		if (rule.when !== undefined) {
			if (!isObject(rule.when)) {
				add(`${label}: when must be an object`, 'when');
			} else if (options.deep && containsKey(rule.when, '$where')) {
				add(`${label}: the $where operator is not supported`, 'when');
			}
		}

		if (!isObject(rule.produce)) {
			add(`${label} must have a produce object`, 'produce');
		} else {
			checkFormula(rule.produce.formula, options, message =>
				add(`${label}: produce ${message}`, 'produce', 'formula'),
			);
		}
	});

	return issues;
}

function checkFormula(
	formula: unknown,
	options: CheckOptions,
	report: (message: string) => void,
): void {
	if (typeof formula !== 'string') {
		report('formula must be a string');
		return;
	}
	if (!options.deep) {
		return;
	}
	try {
		jsonata(formula);
	} catch (error) {
		const { message, position } = (error ?? {}) as {
			message?: unknown;
			position?: unknown;
		};
		const where =
			typeof position === 'number' ? ` at position ${position}` : '';
		report(`formula is invalid${where}: ${String(message)}`);
	}
}

function containsKey(
	value: unknown,
	key: string,
	seen = new Set<object>(),
): boolean {
	if (value === null || typeof value !== 'object' || seen.has(value)) {
		return false;
	}
	seen.add(value);
	if (
		!Array.isArray(value) &&
		Object.prototype.hasOwnProperty.call(value, key)
	) {
		return true;
	}
	return Object.values(value).some(item => containsKey(item, key, seen));
}

/**
 * Checks a rule set without running it: structure, ids, forbidden keys,
 * formula syntax and unsupported operators. Use it when rules are created or
 * edited (for example before saving them). Returns an empty array when the
 * rules are valid.
 */
export function validateRules(rules: unknown): RuleIssue[] {
	return checkRules(rules, { deep: true });
}

/**
 * Standard Schema for a rule set, backed by `validateRules()`. Works with any
 * library that accepts a Standard Schema.
 */
export const rulesSchema: StandardSchemaV1<unknown, Rule[]> = {
	'~standard': {
		version: 1,
		vendor: 'nestjs-business-engine',
		validate: value => {
			const issues = validateRules(value);
			return issues.length > 0 ? { issues } : { value: value as Rule[] };
		},
	},
};
