import assert from "node:assert/strict";
import test from "node:test";
import { frontendHarness, textarea } from "./frontend-harness.mjs";

async function relatedPanel() {
    const panel = Object.assign(new EventTarget(), { setAttribute() {}, contains: () => false });
    const document = Object.assign(new EventTarget(), {
        createElement: () => panel,
        body: { appendChild() {} },
        activeElement: null,
    });
    const { engine, load } = await frontendHarness({
        settings: { enableRelatedTags: true }, values: { document },
    });
    const { RelatedTagsController, findRelatedTagInPrompt } = await load("related-tags.js");
    const controller = new RelatedTagsController(engine);
    const target = textarea("winter, sky", 2);
    target.focus = () => { document.activeElement = target; };
    target.focus();
    target.addEventListener("blur", () => controller.handleBlur());
    target.addEventListener("input", () => controller.handleInput());
    Object.assign(controller, {
        target, visible: true, source: findRelatedTagInPrompt(target.value, "winter"),
        render() {},
    });
    engine.recordTagUsage = () => {};
    return { panel, document, controller, target };
}

test("related panel preserves classic textarea focus until a delayed click inserts the tag", async () => {
    const { panel, document, controller, target } = await relatedPanel();
    // Model the classic canvas's outer pointer handler, which explicitly takes focus.
    // preventDefault alone does not prevent that handler from running.
    panel.addEventListener("pointerdown", event => {
        if (!event.cancelBubble) {
            document.activeElement = {};
            target.dispatchEvent(new Event("blur"));
        }
    });
    panel.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    panel.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(controller.visible, true);
    assert.equal(document.activeElement, target);
    controller.insert({ name: "snow", category: 0 });
    assert.equal(target.value, "winter, snow, sky");
    assert.equal(controller.visible, false);
});

test("related panel contains mouse events and leaves link click defaults available", async () => {
    const { panel } = await relatedPanel();
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        let escaped = false;
        panel.addEventListener(type, event => { escaped = !event.cancelBubble; }, { once: true });
        const event = new Event(type, { bubbles: true, cancelable: true });
        panel.dispatchEvent(event);
        assert.equal(escaped, false, `${type} must not reach the canvas`);
        assert.equal(event.defaultPrevented, type === "pointerdown" || type === "mousedown");
    }
});

test("a pinned related panel inserts repeatedly and selects existing tags without duplicating them", async () => {
    const { controller, target } = await relatedPanel();
    controller.pinned = true;
    controller.insert({ name: "snow", category: 0 });
    controller.insert({ name: "cloud", category: 0 });
    assert.equal(target.value, "winter, cloud, snow, sky");
    controller.insert({ name: "snow", category: 0 });
    assert.equal(target.value, "winter, cloud, snow, sky");
    assert.equal(target.value.slice(target.selectionStart, target.selectionEnd), "snow");
    assert.equal(controller.visible, true);
});
