import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function createEngine(fetchCSV) {
    const settings = { tagFile: "danbooru_ffdkj.csv", extraFiles: "", translationFile: "None" };
    const window = new EventTarget();
    const context = vm.createContext({
        console, window, document: new EventTarget(), CustomEvent, performance, setTimeout, clearTimeout,
        fetch: async (url) => url.includes("/tags/file/")
            ? { ok: true, text: fetchCSV }
            : { json: async () => [] }
    });
    const source = await readFile(new URL("../web/js/autocomplete.js", import.meta.url), "utf8");
    const imports = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)]
        .map(match => [match[2], match[1].split(",").map(name => name.trim())]));
    const values = {
        settingValues: settings, id: "test", logDebug() {}, getActiveControllerNode: () => null,
        t: text => text
    };
    const module = new vm.SourceTextModule(source, { context });
    await module.link(path => new vm.SyntheticModule(imports.get(path), function () {
        for (const name of imports.get(path)) this.setExport(name, values[name] ?? (() => {}));
    }, { context }));
    await module.evaluate();
    const engine = Object.create(module.namespace.TagCompleteEngine.prototype);
    Object.assign(engine, { translations: new Map(), reverseTranslations: new Map(), mainTags: [] });
    return { engine, window };
}

test("a completed dictionary update replaces cached counts and Chinese translations", async () => {
    let csv = 'long_hair,0,500,"old_name,other_name",长发\n';
    let fetches = 0;
    const { engine, window } = await createEngine(async () => { fetches++; return csv; });
    engine.bindGlobalEvents();
    await engine.loadAllData();
    assert.equal(engine.mainTags[0].count, 500);
    csv = 'long_hair,0,600,"old_name,other_name","长发,修订"\n';
    await engine.loadAllData();
    assert.equal(fetches, 1);

    window.dispatchEvent(new CustomEvent("tagcomplete-reload-tags", { detail: { force: true } }));
    await engine.dataLoadPromise;
    assert.equal(fetches, 2);
    assert.equal(engine.mainTags[0].count, 600);
    assert.equal(engine.mainTags[0].sourceFile, "danbooru_ffdkj.csv");
    assert.equal(engine.mainTags[0].aliases.join(","), "old_name,other_name");
    assert.equal(engine.translations.get("long hair"), "长发,修订");
    assert.equal(engine.reverseTranslations.get("长发,修订")[0], "long hair");
});

test("an update during initial loading cannot leave the previous CSV in the cache", async () => {
    let releaseInitial;
    const initialResponse = new Promise(resolve => { releaseInitial = resolve; });
    let fetches = 0;
    const { engine } = await createEngine(async () => {
        fetches++;
        return fetches === 1 ? initialResponse : "long_hair,0,700,,更新译名\n";
    });
    const initialLoad = engine.loadAllData();
    const updatedLoad = engine.loadAllData(true);
    releaseInitial("long_hair,0,500,,旧译名\n");
    await Promise.all([initialLoad, updatedLoad]);
    assert.equal(fetches, 2);
    assert.equal(engine.mainTags[0].count, 700);
    assert.equal(engine.translations.get("long hair"), "更新译名");
    await engine.loadAllData();
    assert.equal(fetches, 2);
});
