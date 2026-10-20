import { readFile } from "node:fs/promises";

export async function frontendHarness(overrides = {}) {
    const settings = {
        enabled: true, tagFile: "fixture.csv", extraFiles: "", translationFile: "None",
        searchTranslation: true, showTranslations: true, frequencySort: false,
        candidateSortMode: "Match", tabAction: "Sort", keyAcceptEnter: true,
        enableCandidateWeightWheel: true, candidateWeightWheelStep: 0.05,
        ...overrides.settings
    };
    const events = new EventTarget();
    const formatting = { replaceUnderscore: true, escapeParentheses: true, autoInsertComma: true, animaArtistMode: "Disabled" };
    const values = {
        console, performance, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0),
        cancelAnimationFrame: clearTimeout, Event, window: events, document: new EventTarget(),
        settingValues: settings, id: "test", t: text => text, logDebug() {},
        getActiveControllerNode: () => null, getEffectiveFormattingSettings: () => formatting,
        getEffectiveIntegrationsSettings: () => ({ enableModels: false, loraManagerMode: "Disabled" }),
        isLoraManagerAvailable: () => false, isKeepUnderscoresTextarea: () => false,
        buildUnderscoreExclusionSet: () => new Set(), formatTagUnderscores: text => text.replace(/_/g, " "),
        fetch: async url => url.includes("/tags/file/")
            ? { ok: true, text: overrides.csv || (async () => "") }
            : { json: async () => [] },
        ...overrides.values
    };
    const modules = new Map();
    async function load(name, path) {
        if (modules.has(name)) return modules.get(name);
        let source = await readFile(path || new URL(`../web/js/${name}`, import.meta.url), "utf8");
        const imported = [...source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*"([^"]+)";?$/gm)];
        for (const match of imported) {
            if (["./prompt-tags.js", "./candidate-weights.js", "./hotkeys.js"].includes(match[2])) {
                Object.assign(values, await load(match[2].slice(2)));
            }
        }
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map(match => match[1]);
        const parameters = [...new Set([...Object.keys(values), ...imported.flatMap(match => match[1].split(",").map(name => name.trim()))])];
        source = source.replace(/^import .*;?\r?\n/gm, "").replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let))/g, "");
        const result = new Function(...parameters, source + `\nreturn {${names.join(",")}};`)(...parameters.map(name => values[name] ?? (() => {})));
        modules.set(name, result);
        return result;
    }
    const { TagCompleteEngine } = await load("autocomplete.js", overrides.sourcePath);
    const { CandidateWeights } = await load("candidate-weights.js");
    const engine = Object.create(TagCompleteEngine.prototype);
    Object.assign(engine, {
        mainTags: [], extraTags: [], translations: new Map(), reverseTranslations: new Map(),
        userUsageMap: {}, candidateWeights: new CandidateWeights(), candidateCategoryCounts: new Map(),
        results: [], allResults: [], candidateCategory: "all", selectedIndex: 0, pageIndex: 0,
        searchGeneration: 0, dictionaryVersion: 0, searchTimer: null, isVisible: false,
        hideThumbnailPreview() {}, hideInfoPopover() {}, unlockMouseHover() {},
        domContainer: { style: {} }
    });
    return { engine, settings, formatting, values, load, events };
}

export function textarea(value, cursor = value.length) {
    return Object.assign(new EventTarget(), {
        value, selectionStart: cursor, selectionEnd: cursor,
        focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    });
}
