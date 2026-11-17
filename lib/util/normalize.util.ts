/**
 * JSONata marks the arrays it builds with enumerable flags such as
 * `sequence: true`, which leak into `Object.keys`, spreads and strict
 * equality checks. Returns the value with those arrays replaced by plain
 * arrays. Values that need no change keep their identity, and cycles are
 * handled.
 */
export function toPlainValue<T>(value: T): T {
	return normalize(value, new Map()) as T;
}

function normalize(value: unknown, seen: Map<object, unknown>): unknown {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (seen.has(value)) {
		return seen.get(value);
	}

	if (Array.isArray(value)) {
		// Provisional entry so cycles resolve to the original array.
		seen.set(value, value);
		const items = value.map(item => normalize(item, seen));
		const changed =
			Object.keys(value).length !== value.length ||
			items.some((item, index) => item !== value[index]);
		const result = changed ? items : value;
		seen.set(value, result);
		return result;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		// Dates, class instances, buffers...: leave untouched.
		return value;
	}

	seen.set(value, value);
	const source = value as Record<string, unknown>;
	let copy: Record<string, unknown> | undefined;
	for (const key of Object.keys(source)) {
		const item = normalize(source[key], seen);
		if (item !== source[key]) {
			copy ??= { ...source };
			copy[key] = item;
		}
	}
	const result = copy ?? value;
	seen.set(value, result);
	return result;
}
