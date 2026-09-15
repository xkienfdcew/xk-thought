/** Markdown frontmatter splitter built on the YAML-subset parser. */

import { parseYamlSubset } from "./yaml.ts";

export interface Frontmatter {
	data: Record<string, unknown>;
	body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(markdown: string): Frontmatter {
	const m = FRONTMATTER_RE.exec(markdown.replace(/^\uFEFF/, ""));
	if (!m) return { data: {}, body: markdown };
	const parsed = parseYamlSubset(m[1]);
	const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	return { data, body: m[2] ?? "" };
}
