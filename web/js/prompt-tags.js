// Shared prompt membership and source ranges for both candidate windows.
export function normalizePromptTag(raw) {
    return String(raw || "").trim().replace(/^@/, "")
        .replace(/\\([()[\]{},|\\])/g, "$1")
        .toLowerCase().replace(/[ \t]+/g, "_");
}

let cachedText;
let cachedIndex;

export function getPromptTagIndex(text) {
    if (text === cachedText) return cachedIndex;
    const spans = [];
    const parse = (from, to, outer = null, weight = 1) => {
        while (from < to && /\s/.test(text[from])) from++;
        while (to > from && /\s/.test(text[to - 1])) to--;
        if (from === to) return;
        let start = from;
        const stack = [];
        const closing = { ")": "(", "]": "[", "}": "{", ">": "<" };
        const parts = [];
        for (let i = from; i < to; i++) {
            const c = text[i];
            if (c === "\\") { i++; continue; }
            if ("([{<".includes(c)) stack.push(c);
            else if (closing[c] && closing[c] === stack[stack.length - 1]) stack.pop();
            else if (!stack.length && /[,\n\r]/.test(c)) {
                parts.push([start, i]);
                start = i + 1;
            }
        }
        if (parts.length) {
            parts.push([start, to]);
            for (const [a, b] of parts) parse(a, b, null, weight);
            return;
        }
        const raw = text.slice(from, to);
        if (/^(?:__|embedding:|emb:|\/|<|\{)/i.test(raw) || /(^|[^\\])[|{}<>]/.test(raw)) return;
        if ((raw[0] === "(" && raw.endsWith(")")) || (raw[0] === "[" && raw.endsWith("]"))) {
            let depth = 0;
            let wraps = true;
            for (let i = 0; i < raw.length; i++) {
                if (raw[i] === "\\") { i++; continue; }
                if (raw[i] === raw[0]) depth++;
                if (raw[i] === raw.at(-1)) depth--;
                if (!depth && i < raw.length - 1) { wraps = false; break; }
            }
            if (wraps && !depth) {
                const match = raw.slice(1, -1).match(/\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*$/);
                // Prompt scheduling/alternation is not a literal tag.
                if (raw[0] === "[" && /(^|[^\\]):/.test(raw)) return;
                parse(from + 1, to - 1 - (match?.[0].length || 0), outer || { start: from, end: to }, match ? Number(match[1]) : weight);
                return;
            }
        }
        if (/(^|[^\\])[\[\]]/.test(raw) || /:\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*$/.test(raw)) return;
        const name = normalizePromptTag(raw);
        if (name) spans.push({ start: outer?.start ?? from, end: outer?.end ?? to, contentStart: from, contentEnd: to, text: text.slice(outer?.start ?? from, outer?.end ?? to), name, weight });
    };
    parse(0, text.length);
    const byName = new Map();
    for (const span of spans) {
        if (!byName.has(span.name)) byName.set(span.name, []);
        byName.get(span.name).push(span);
    }
    cachedText = text;
    return cachedIndex = { spans, byName };
}

export function findPromptTag(text, name, exclude = null) {
    return getPromptTagIndex(text).byName.get(normalizePromptTag(name))
        ?.find(span => !exclude || span.end <= exclude.start || span.start >= exclude.end) || null;
}

export function promptTagAtCursor(text, cursor) {
    return getPromptTagIndex(text).spans.find(span => cursor >= span.start && cursor <= span.end) || null;
}
