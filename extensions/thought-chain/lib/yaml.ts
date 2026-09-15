/**
 * Minimal YAML subset parser (zero dependencies).
 *
 * Supported: `key: value`, nested maps, block lists (scalars and maps),
 * inline lists `[a, b]`, quoted strings, booleans, numbers, null, and
 * trailing/standalone `#` comments.
 *
 * Not supported (intentionally): anchors, aliases, multi-line scalars,
 * flow maps, tags. Chain/template frontmatter does not need them.
 */

interface Line {
	indent: number;
	text: string;
}

function stripComment(s: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "'" && !inDouble) inSingle = !inSingle;
		else if (c === '"' && !inSingle) inDouble = !inDouble;
		else if (c === "#" && !inSingle && !inDouble && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
			return s.slice(0, i);
		}
	}
	return s;
}

function preprocess(text: string): Line[] {
	const out: Line[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const expanded = raw.replace(/\t/g, "  ");
		const noComment = stripComment(expanded);
		if (noComment.trim() === "") continue;
		const indent = noComment.length - noComment.trimStart().length;
		out.push({ indent, text: noComment.trim() });
	}
	return out;
}

function isListLine(text: string): boolean {
	return text === "-" || text.startsWith("- ");
}

function isMapEntry(text: string): boolean {
	if (text.startsWith("[")) return false;
	const ci = indexOfKeyColon(text);
	return ci > 0;
}

function indexOfKeyColon(text: string): number {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "'" && !inDouble) inSingle = !inSingle;
		else if (c === '"' && !inSingle) inDouble = !inDouble;
		else if (c === ":" && !inSingle && !inDouble) return i;
	}
	return -1;
}

function unquote(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

function splitTopLevel(body: string, sep: string): string[] {
	const items: string[] = [];
	let current = "";
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === "'" && !inDouble) inSingle = !inSingle;
		else if (c === '"' && !inSingle) inDouble = !inDouble;
		if (!inSingle && !inDouble) {
			if (c === "[" || c === "{") depth++;
			else if (c === "]" || c === "}") depth--;
			else if (c === sep && depth === 0) {
				items.push(current);
				current = "";
				continue;
			}
		}
		current += c;
	}
	if (current.trim() !== "") items.push(current);
	return items;
}

function splitInlineList(body: string): string[] {
	return splitTopLevel(body, ",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parseInlineMap(body: string): Record<string, unknown> {
	const obj: Record<string, unknown> = {};
	for (const part of splitTopLevel(body, ",")) {
		const ci = indexOfKeyColon(part);
		if (ci < 0) continue;
		const key = part.slice(0, ci).trim();
		const value = part.slice(ci + 1).trim();
		if (key) obj[key] = parseScalar(value);
	}
	return obj;
}

function parseScalar(s: string): unknown {
	const t = s.trim();
	if (t === "" || t === "null" || t === "~") return null;
	if (t === "true") return true;
	if (t === "false") return false;
	if (/^-?\d+$/.test(t)) return Number(t);
	if (/^-?\d+\.\d+$/.test(t)) return Number(t);
	if (t.startsWith("[") && t.endsWith("]")) return splitInlineList(t.slice(1, -1)).map(parseScalar);
	if (t.startsWith("{") && t.endsWith("}")) return parseInlineMap(t.slice(1, -1));
	return unquote(t);
}

interface ParseResult {
	value: unknown;
	next: number;
}

function parseBlock(lines: Line[], start: number, minIndent: number): ParseResult {
	if (start >= lines.length || lines[start].indent < minIndent) return { value: null, next: start };
	const indent = lines[start].indent;
	if (isListLine(lines[start].text)) return parseList(lines, start, indent);
	return parseMap(lines, start, indent);
}

function parseMap(lines: Line[], start: number, indent: number): ParseResult {
	const obj: Record<string, unknown> = {};
	let i = start;
	while (i < lines.length && lines[i].indent === indent && !isListLine(lines[i].text)) {
		const text = lines[i].text;
		const ci = indexOfKeyColon(text);
		if (ci < 0) break;
		const key = text.slice(0, ci).trim();
		const rest = text.slice(ci + 1).trim();
		if (rest === "") {
			if (i + 1 < lines.length && lines[i + 1].indent > indent) {
				const res = parseBlock(lines, i + 1, indent + 1);
				obj[key] = res.value;
				i = res.next;
			} else {
				obj[key] = null;
				i++;
			}
		} else {
			obj[key] = parseScalar(rest);
			i++;
		}
	}
	return { value: obj, next: i };
}

function parseList(lines: Line[], start: number, indent: number): ParseResult {
	const arr: unknown[] = [];
	let i = start;
	while (i < lines.length && lines[i].indent === indent && isListLine(lines[i].text)) {
		const content = lines[i].text.replace(/^-\s?/, "");
		if (content === "") {
			const res = parseBlock(lines, i + 1, indent + 1);
			arr.push(res.value);
			i = res.next;
		} else if (isMapEntry(content)) {
			// Collect the item's continuation lines (indent > list indent).
			let j = i + 1;
			const continuation: Line[] = [];
			while (j < lines.length && lines[j].indent > indent) {
				continuation.push(lines[j]);
				j++;
			}
			const restIndent = continuation.length > 0 ? Math.min(...continuation.map((l) => l.indent)) : indent + 2;
			const itemLines: Line[] = [{ indent: restIndent, text: content }, ...continuation];
			const res = parseMap(itemLines, 0, restIndent);
			arr.push(res.value);
			i = j;
		} else {
			arr.push(parseScalar(content));
			i++;
		}
	}
	return { value: arr, next: i };
}

export function parseYamlSubset(text: string): unknown {
	const lines = preprocess(text);
	if (lines.length === 0) return {};
	const result = parseBlock(lines, 0, 0);
	return result.value;
}
