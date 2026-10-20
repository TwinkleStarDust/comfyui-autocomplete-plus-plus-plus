import assert from "node:assert/strict";
import test from "node:test";
import { frontendHarness, textarea } from "./frontend-harness.mjs";

const csv = `yui,4,100,,唯
hirasawa_yui,4,5000,"yuihirasawa,平沢唯",平泽唯
yui_new,4,20,,新唯
blue_hair,0,900,,蓝发
hair,0,2000,,头发
artist_name,1,80,artist_alias,画师
`;

test("matching tiers, aliases, translations, count sorting and categories survive preprocessing", async () => {
    const { engine, settings } = await frontendHarness({ csv: async () => csv });
    assert.deepEqual((await engine.searchCandidates("yui")).map(item => item.text), ["yui", "yui_new", "hirasawa_yui"]);
    settings.candidateSortMode = "Count";
    assert.deepEqual((await engine.searchCandidates("yui")).map(item => item.text), ["yui", "hirasawa_yui", "yui_new"]);
    assert.equal((await engine.searchCandidates("yuihirasawa"))[0].matchedAlias, "yuihirasawa");
    assert.equal((await engine.searchCandidates("平沢唯"))[0].text, "hirasawa_yui");
    assert.equal((await engine.searchCandidates("平泽"))[0].text, "hirasawa_yui");
    assert.deepEqual((await engine.searchCandidates("/character yui")).map(item => item.text), ["yui", "hirasawa_yui", "yui_new"]);
    settings.searchTranslation = false;
    assert.equal((await engine.searchCandidates("平泽")).length, 0);
    assert.equal((await engine.searchCandidates("blue hair"))[0].text, "blue_hair");
});

test("artist search keeps primary, alias and translation matching", async () => {
    const { engine } = await frontendHarness({ csv: async () => csv });
    engine.isAnimaWorkflowActive = () => true;
    assert.equal((await engine.searchCandidates("@artist_alias"))[0].text, "@artist_name");
    assert.equal((await engine.searchCandidates("@画师"))[0].text, "@artist_name");
    assert.equal((await engine.searchCandidates("@"))[0].text, "@artist_name");
});

test("membership handles weights, escaping, separators and full names, excluding the current token", async () => {
    const { load } = await frontendHarness();
    const { findPromptTag, getPromptTagIndex, promptTagAtCursor } = await load("prompt-tags.js");
    const text = "(Blue Hair:1.2), @artist_name, hirasawa_yui_\\(k-on!\\), blue_hair, {smile|sad}, <lora:hair:1>, embedding:hair";
    assert.equal(findPromptTag(text, "blue_hair").weight, 1.2);
    assert.ok(findPromptTag(text, "artist name"));
    assert.ok(findPromptTag(text, "hirasawa_yui_(k-on!)"));
    assert.equal(findPromptTag(text, "hair"), null);
    assert.equal(findPromptTag(text, "smile"), null);
    assert.equal(getPromptTagIndex(text), getPromptTagIndex(text));
    const editing = promptTagAtCursor(text, 5);
    assert.ok(findPromptTag(text, "blue hair", editing));
    assert.equal(findPromptTag("(blue_hair:1.2)", "blue hair", { start: 0, end: 15 }), null);
    assert.ok(findPromptTag("(red_hair, blue_eyes:1.2)", "blue eyes"));
    assert.equal(findPromptTag("[smile:sad:0.5]", "sad"), null);
});

test("only the latest text, cursor and dictionary generation may render", async () => {
    const { engine } = await frontendHarness();
    engine.loadAllData = async () => {};
    const pending = [];
    engine.searchCandidates = query => new Promise(resolve => pending.push({ query, resolve }));
    const rendered = [];
    engine.renderResults = () => rendered.push(engine.results.map(item => item.text));
    const target = textarea("yu");
    const old = engine.triggerSearch(target);
    await Promise.resolve();
    target.value = "yui"; target.setSelectionRange(3, 3);
    const latest = engine.triggerSearch(target);
    await Promise.resolve();
    pending[1].resolve([{ text: "hirasawa_yui" }]); await latest;
    pending[0].resolve([{ text: "obsolete" }]); await old;
    assert.deepEqual(rendered, [["hirasawa_yui"]]);
    const moved = engine.triggerSearch(target); await Promise.resolve();
    target.setSelectionRange(0, 0); pending[2].resolve([{ text: "moved" }]); await moved;
    assert.equal(rendered.length, 1);
    target.setSelectionRange(1, 1);
    const reloaded = engine.triggerSearch(target); await Promise.resolve();
    engine.dictionaryVersion++; pending[3].resolve([]); await reloaded;
    assert.equal(rendered.length, 1);
});

test("composition suppresses searches and Tab while composing; commit coalesces input", async () => {
    const { engine } = await frontendHarness();
    const target = textarea("头发");
    let searches = 0;
    engine.triggerSearch = async () => { searches++; };
    engine.handleCompositionStart();
    engine.handleInput({ target, isComposing: true });
    await engine.handleKeyDown({ key: "Tab", isComposing: true, preventDefault() { assert.fail("IME Tab intercepted"); } });
    assert.equal(engine.searchTimer, null);
    engine.handleCompositionEnd({ target });
    engine.handleInput({ target });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(searches, 1);
});

test("Tab sort, legacy insertion and Shift+Tab are distinct", async () => {
    const { engine, settings } = await frontendHarness();
    engine.isVisible = true; engine.results = [{ text: "hair" }];
    let sorted = 0, inserted = 0, prevented = 0;
    engine.toggleSort = () => sorted++;
    engine.insertTag = () => inserted++;
    const key = { key: "Tab", preventDefault() { prevented++; }, stopImmediatePropagation() {} };
    await engine.handleKeyDown(key);
    assert.equal(sorted, 1); assert.equal(inserted, 0);
    settings.tabAction = "Insert"; await engine.handleKeyDown(key);
    assert.equal(inserted, 1);
    await engine.handleKeyDown({ ...key, shiftKey: true });
    settings.tabAction = "Disabled"; await engine.handleKeyDown(key);
    assert.equal(prevented, 2);
});

test("weight insertion formats escaped names once and replaces an existing emphasis wrapper", async () => {
    const { engine } = await frontendHarness();
    engine.isAnimaWorkflowActive = () => false;
    engine.target = textarea("yui"); engine.tagwordStart = 0; engine.tagwordEnd = 3; engine.currentTagword = "yui";
    const item = { text: "hirasawa_yui_(k-on!)", category: 4 };
    engine.candidateWeights.values.set(engine.candidateWeights.key(item), 1.05);
    await engine.insertTag(item);
    assert.equal(engine.target.value, "(hirasawa yui \\(k-on!\\):1.05), ");
    engine.target = textarea("(blue_hair:1.2)", 5); engine.tagwordStart = 1; engine.tagwordEnd = 5; engine.currentTagword = "blue";
    const hair = { text: "blue_hair", category: 0 };
    engine.candidateWeights.values.set(engine.candidateWeights.key(hair), 1.25);
    await engine.insertTag(hair);
    assert.equal(engine.target.value, "(blue hair:1.25), ");
});

test("related sorting uses all neighbors before applying the display limit", async () => {
    const { load } = await frontendHarness();
    const { rankRelatedTags } = await load("related-tags.js");
    const source = { name: "source", count: 100 };
    const index = new Map([["close", { name: "close", count: 100 }], ["popular", { name: "popular", count: 10000 }]]);
    const neighbors = [{ name: "close", cooccurrence: 80 }, { name: "popular", cooccurrence: 90 }];
    assert.equal(rankRelatedTags(source, neighbors, index, 1)[0].name, "close");
    assert.equal(rankRelatedTags(source, neighbors, index, 1, "Count")[0].name, "popular");
});

test("wheel previews stay per candidate, honor the switch and step, and exclude commands", async () => {
    const badges = [];
    const { engine, settings, load } = await frontendHarness({ values: {
        document: { createElement() { const badge = {}; badges.push(badge); return badge; } }
    } });
    const { applyCandidateWeight } = await load("candidate-weights.js");
    const row = Object.assign(new EventTarget(), { appendChild() {} });
    const tag = { text: "hair" }, other = { text: "eyes" };
    engine.candidateWeights.bind(row, tag);
    const wheel = (deltaY, shiftKey = true) => {
        const event = new Event("wheel", { cancelable: true });
        Object.assign(event, { deltaY, shiftKey }); row.dispatchEvent(event); return event;
    };
    assert.equal(wheel(-120).defaultPrevented, true);
    assert.equal(engine.candidateWeights.get(tag), 1.05);
    assert.equal(engine.candidateWeights.get(other), undefined);
    wheel(120); assert.equal(engine.candidateWeights.get(tag), 1);
    settings.candidateWeightWheelStep = 0.1; wheel(-120);
    assert.equal(engine.candidateWeights.get(tag), 1.1);
    assert.equal(wheel(-120, false).defaultPrevented, false);
    settings.enableCandidateWeightWheel = false;
    assert.equal(wheel(-120).defaultPrevented, false);
    assert.equal(engine.candidateWeights.get(tag), 1.1);
    engine.candidateWeights.bind(row, { text: "<lora:", type: "lora_prefix" });
    assert.equal(badges.length, 1);
    assert.equal(applyCandidateWeight("<lora:folder/model:1.0>", 0.85, "lora"), "<lora:folder/model:0.85>");
    assert.equal(applyCandidateWeight("embedding:model", 1.1, "embeddings"), "(embedding:model:1.1)");
    engine.hide(); assert.equal(engine.candidateWeights.values.size, 0);
});

test("large searches yield and cancellation discards the incomplete scan", async () => {
    let ticks = 0;
    const { engine } = await frontendHarness({ values: { performance: { now: () => ticks++ } } });
    engine.loadAllData = async () => {};
    engine.mainTags = Array.from({ length: 12000 }, (_, i) => ({ name: `hair_${i}`, category: 0, count: i, aliases: [], search: { name: `hair_${i}`, nameLower: `hair_${i}`, translation: "", aliases: [] } }));
    let current = true;
    const pending = engine.searchCandidates("hair", () => current);
    setTimeout(() => { current = false; }, 0);
    assert.deepEqual(await pending, []);
    const all = await engine.searchCandidates("hair");
    assert.equal(all.length, 12000);
    engine.setResults(all);
    assert.equal(engine.results.length, 12000);
});

test("related weight confirmation updates the existing occurrence, and pinned source ranges stay valid", async () => {
    const { engine, load } = await frontendHarness();
    const { RelatedTagsController, findRelatedTagInPrompt } = await load("related-tags.js");
    const controller = Object.create(RelatedTagsController.prototype);
    const target = textarea("(cloud:1.2), scenery", 17);
    Object.assign(controller, { engine, target, source: findRelatedTagInPrompt(target.value, "scenery"), candidateWeights: engine.candidateWeights, isEnabled: () => true, pinned: true, render() {} });
    const item = { name: "cloud", category: 0 };
    controller.candidateWeights.values.set(controller.candidateWeights.key(item), 1.25);
    controller.insert(item);
    assert.equal(target.value, "(cloud:1.25), scenery");
    assert.equal(target.value.slice(controller.source.start, controller.source.end), "scenery");
});
