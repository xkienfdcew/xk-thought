/** Minimal glob + path extraction. Zero dependencies. */

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

function escapeRegexChar(ch: string): string {
	return ch.replace(REGEX_SPECIAL, "\\$&");
}

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Convert a glob to a RegExp.
 * Supports `**` (any depth), `*` (within a segment), `?` (single char).
 */
export function globToRegExp(pattern: string): RegExp {
	const glob = normalizePath(pattern);
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				i++;
				if (glob[i + 1] === "/") {
					re += "(?:.*/)?";
					i++;
				} else {
					re += ".*";
				}
			} else {
				re += "[^/]*";
			}
		} else if (c === "?") {
			re += "[^/]";
		} else {
			re += escapeRegexChar(c);
		}
	}
	const flags = process.platform === "win32" ? "i" : "";
	return new RegExp(`^${re}$`, flags);
}

export function globMatch(pattern: string, filePath: string): boolean {
	try {
		return globToRegExp(pattern).test(normalizePath(filePath));
	} catch {
		return false;
	}
}

const EXTENSIONS =
	"ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|md|mdx|txt|json|jsonc|ya?ml|toml|ini|cfg|log|csv|tsv|sql|sh|ps1|bat|html|css|scss|xml";

const AT_PATH_RE = /(?:^|\s)@([^\s]+)/g;
const SLASHY_PATH_RE = /\b[\w.@~-]+(?:[/\\][\w.@~-]+)+\b/g;
const FILENAME_RE = new RegExp(`\\b[\\w.-]+\\.(?:${EXTENSIONS})\\b`, "gi");

/** Extract candidate file paths mentioned in free-form text (for fileGlobs matching). */
export function extractPaths(text: string): string[] {
	const out = new Set<string>();
	const withoutUrls = text.replace(/https?:\/\/\S+/gi, " ");
	for (const re of [AT_PATH_RE, SLASHY_PATH_RE, FILENAME_RE]) {
		re.lastIndex = 0;
		for (const match of withoutUrls.matchAll(re)) {
			const raw = match[1] ?? match[0];
			const cleaned = raw.replace(/[.,;:)\]}"'`]+$/, "").replace(/^["'`(]+/, "");
			if (cleaned.length > 0 && !/^https?:\/\//i.test(cleaned)) out.add(normalizePath(cleaned));
		}
	}
	return [...out];
}
