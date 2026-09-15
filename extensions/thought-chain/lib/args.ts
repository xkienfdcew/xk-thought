/** Shared argument helpers for slash commands. */

/** Strip one layer of matching surrounding quotes from an argument. */
export function stripQuotes(s: string): string {
	const t = s.trim();
	if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
		return t.slice(1, -1).trim();
	}
	return t;
}
