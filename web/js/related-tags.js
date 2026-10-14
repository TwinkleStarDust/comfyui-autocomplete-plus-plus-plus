// Related Tags Display, ported from newtextdoc1111/ComfyUI-Autocomplete-Plus (MIT).
import { settingValues, isComfyThemeLight } from "./settings.js";
import { t } from "./i18n.js";
import { insertTextWithUndo } from "./hotkeys.js";
import { getFixedCaretCoordinates } from "./caret-position.js";
import { getEffectiveFormattingSettings, isKeepUnderscoresTextarea, buildUnderscoreExclusionSet, formatTagUnderscores } from "./auto-formatter.js";

export function normalizeRelatedTag(raw) {
    let tag = String(raw || "").trim();
    if (tag.startsWith("__") || /^(?:embedding:|emb:|\/|<)/i.test(tag)) return "";
    tag = tag.replace(/^@/, "");
    // Remove prompt emphasis/weights, preserving escaped parentheses in tag names.
    while (tag.startsWith("(") && tag.endsWith(")")) {
        let depth = 0;
        let encloses = true;
        for (let i = 0; i < tag.length; i++) {
            if (tag[i] === "\\") { i++; continue; }
            if (tag[i] === "(") depth++;
            if (tag[i] === ")") depth--;
            if (depth === 0 && i < tag.length - 1) { encloses = false; break; }
        }
        if (!encloses || depth !== 0) break;
        tag = tag.slice(1, -1).replace(/\s*:\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*$/, "").trim();
    }
    if (/(^|[^\\])[{}\[\]|<>]/.test(tag)) return "";
    return tag.replace(/\\([()[\]{},|\\])/g, "$1").toLowerCase().replace(/[ \t]+/g, "_");
}

function promptTagSpans(text) {
    const spans = [];
    let start = 0;
    let startsInsideGroup = false;
    const groups = [];
    const closing = { ")": "(", "]": "[", "}": "{" };
    for (let i = 0; i <= text.length; i++) {
        if (text[i] === "\\") { i++; continue; }
        if (i === text.length || /[,\n\r]/.test(text[i])) {
            const raw = text.slice(start, i);
            const leading = raw.length - raw.trimStart().length;
            const end = i - (raw.length - raw.trimEnd().length);
            if (!startsInsideGroup && start + leading < end) {
                spans.push({ start: start + leading, end, text: text.slice(start + leading, end), from: start, to: i });
            }
            start = i + 1;
            startsInsideGroup = groups.length > 0;
        } else if ("([{".includes(text[i])) {
            groups.push(text[i]);
        } else if (closing[text[i]] && closing[text[i]] === groups[groups.length - 1]) {
            groups.pop();
        }
    }
    return spans;
}

export function getRelatedTagAtCursor(text, cursor) {
    const span = promptTagSpans(text).find(item => cursor >= item.from && cursor <= item.to);
    if (!span) return null;
    const name = normalizeRelatedTag(span.text);
    return name ? { ...span, name } : null;
}

export function findRelatedTagInPrompt(text, name) {
    const key = normalizeRelatedTag(name);
    return promptTagSpans(text).find(span => normalizeRelatedTag(span.text) === key) || null;
}

export function rankRelatedTags(source, neighbors, tagIndex, limit) {
    const countA = Number(source.count) || 0;
    return neighbors.flatMap(neighbor => {
        const tag = tagIndex.get(neighbor.name);
        if (!tag || tag === source) return [];
        const countB = Number(tag.count) || 0;
        const shared = Number(neighbor.cooccurrence) || 0;
        const union = countA + countB - shared;
        const similarity = countA > 0 && countB > 0 && union > 0 ? shared / union : 0;
        return [{ ...tag, cooccurrence: shared, similarity }];
    }).sort((a, b) => b.similarity - a.similarity || b.cooccurrence - a.cooccurrence).slice(0, limit);
}

export function buildRelatedInsertion(text, source, tag, formatting) {
    const space = formatting.formatSpaceAfterComma === false ? "" : " ";
    const remainder = text.slice(source.end);
    const atEnd = remainder.trim() === "" && !/[\r\n]/.test(remainder);
    const inserted = "," + space + tag + (atEnd && formatting.autoInsertComma ? "," + space : "");
    return { start: source.end, end: atEnd ? text.length : source.end, text: inserted, cursor: source.end + inserted.length };
}

const categoryColors = { 0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta" };

export class RelatedTagsController {
    constructor(engine) {
        this.engine = engine;
        engine.relatedTags = this;
        this.requestId = 0;
        this.cache = new Map();
        this.tagIndex = new Map();
        this.results = [];
        this.visible = false;
        this.pinned = false;
        this.inserting = false;
        this.panel = document.createElement("div");
        this.panel.id = "tagcomplete-related-panel";
        this.panel.className = "ac-related-panel";
        this.panel.hidden = true;
        this.panel.setAttribute("role", "region");
        document.body.appendChild(this.panel);
        // Keep the textarea focused, including when clicking toolbar buttons.
        this.panel.addEventListener("mousedown", event => event.preventDefault());
        document.addEventListener("pointerdown", event => {
            if (this.visible && !this.panel.contains(event.target) && event.target !== this.target) this.hide();
        }, true);
        window.addEventListener("resize", () => this.updatePosition());
        window.addEventListener("wheel", () => requestAnimationFrame(() => this.updatePosition()), { passive: true });
        window.addEventListener("autocomplete-related-settings-changed", () => this.hide());
    }

    isEnabled(target) {
        return settingValues.enabled && settingValues.enableRelatedTags && target && !target.readOnly && !target.disabled && !isKeepUnderscoresTextarea(target);
    }

    rebuildTagIndex() {
        if (this.mainTags === this.engine.mainTags && this.extraTags === this.engine.extraTags) return;
        this.mainTags = this.engine.mainTags;
        this.extraTags = this.engine.extraTags;
        this.tagIndex.clear();
        for (const tag of [...this.mainTags, ...this.extraTags]) {
            // A Danbooru count is needed for Jaccard; do not mix in e621 counts.
            if (!tag.sourceFile?.includes("danbooru")) continue;
            const key = normalizeRelatedTag(tag.name);
            if (key && !this.tagIndex.has(key)) this.tagIndex.set(key, tag);
        }
    }

    async lookup(name) {
        if (this.cache.has(name)) return this.cache.get(name);
        const response = await fetch(`/autocomplete-plus-plus/related-tags?tag=${encodeURIComponent(name)}`);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            if (data.error === "missing_index") throw new Error("Related tag index is missing.");
            if (data.error === "index_unavailable") throw new Error("Unable to read the related tag index; rebuild it.");
            throw new Error(response.status === 404 ? "Restart ComfyUI to load the related-tags API." : "Unable to load related tags. Try again.");
        }
        const data = await response.json();
        if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(name, data.related || []);
        return data.related || [];
    }

    async show(target) {
        if (!this.isEnabled(target)) { this.hide(); return; }
        const source = getRelatedTagAtCursor(target.value, target.selectionStart);
        if (!source) { this.hide(); return; }
        const requestId = ++this.requestId;
        const originalValue = target.value;
        const originalCursor = target.selectionStart;
        await this.engine.loadAllData();
        if (requestId !== this.requestId || target.value !== originalValue || target.selectionStart !== originalCursor) return;
        this.rebuildTagIndex();
        const sourceData = this.tagIndex.get(source.name);
        if (!sourceData) { this.hide(); return; }
        this.target = target;
        this.source = source;
        this.selectedIndex = 0;
        this.layout = settingValues.relatedTagsLayout;
        this.results = [];
        this.engine.hide();
        this.visible = true;
        this.panel.hidden = false;
        this.render(t("Loading related tags…"));
        try {
            const neighbors = await this.lookup(source.name);
            if (requestId !== this.requestId || !this.isEnabled(target) || target.value !== originalValue || target.selectionStart !== originalCursor) {
                if (requestId === this.requestId) this.hide();
                return;
            }
            this.results = rankRelatedTags(sourceData, neighbors, this.tagIndex, settingValues.maxRelatedTags);
            this.render(this.results.length ? "" : t("No related tags in the active Danbooru dictionary."));
        } catch (error) {
            if (requestId === this.requestId) this.render(t(error instanceof TypeError ? "Unable to load related tags. Try again." : error.message));
        }
    }

    handleClick(event) {
        const mode = settingValues.relatedTagsTrigger;
        if (event.shiftKey || event.altKey || mode === "Shortcut only" || (mode === "Ctrl + Click" && !event.ctrlKey)) { this.hide(); return; }
        this.show(event.target);
    }

    handleKeyDown(event) {
        if (!this.isEnabled(event.target)) { this.hide(); return false; }
        const shortcut = event.ctrlKey && event.shiftKey && (event.code === "Space" || event.key === " ");
        if (shortcut) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.show(event.target);
            return true;
        }
        if (!this.visible || this.target !== event.target) return false;
        const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
        let direction = 0;
        if (plain && (event.key === "ArrowDown" || (this.layout === "Horizontal" && event.key === "ArrowRight"))) direction = 1;
        if (plain && (event.key === "ArrowUp" || (this.layout === "Horizontal" && event.key === "ArrowLeft"))) direction = -1;
        const accepts = plain && ((event.key === "Enter" && settingValues.keyAcceptEnter) || (event.key === "Tab" && settingValues.keyAcceptTab));
        if (direction || accepts || event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key === "Escape") this.hide();
            else if (direction && this.results.length) {
                this.selectedIndex = (this.selectedIndex + direction + this.results.length) % this.results.length;
                this.updateSelection();
            } else if (accepts && this.results.length) this.insert(this.results[this.selectedIndex]);
            return true;
        }
        if (!event.isComposing && !["Control", "Shift", "Alt", "Meta"].includes(event.key)) this.hide();
        return false;
    }

    handleInput() {
        if (!this.inserting) this.hide();
    }

    handleBlur() {
        setTimeout(() => {
            if (this.visible && document.activeElement !== this.target && !this.panel.contains(document.activeElement)) this.hide();
        }, 0);
    }

    hide() {
        this.requestId++;
        this.visible = false;
        this.pinned = false;
        this.panel.hidden = true;
        this.target = null;
    }

    translation(name) {
        if (!settingValues.showTranslations) return "";
        return this.engine.translations.get(String(name).trim().toLowerCase().replace(/_/g, " ")) || "";
    }

    render(message = "") {
        this.panel.replaceChildren();
        this.panel.dataset.theme = isComfyThemeLight() ? "light" : "dark";
        this.panel.dataset.layout = this.layout;
        this.panel.setAttribute("aria-label", t("Related Tags"));
        const header = document.createElement("div");
        header.className = "ac-related-header";
        const title = document.createElement("strong");
        const translated = this.translation(this.source.name);
        title.textContent = `${t("Related Tags")}: ${this.source.name}${translated ? " · " + translated : ""}`;
        header.appendChild(title);
        const toolbarButton = (label, text, handler) => {
            const button = document.createElement("button");
            button.type = "button";
            button.title = label;
            button.setAttribute("aria-label", label);
            button.textContent = text;
            button.addEventListener("click", handler);
            header.appendChild(button);
            return button;
        };
        const pin = toolbarButton(t("Keep open after insertion"), this.pinned ? "◆" : "◇", () => {
            this.pinned = !this.pinned;
            pin.textContent = this.pinned ? "◆" : "◇";
            pin.setAttribute("aria-pressed", String(this.pinned));
        });
        pin.setAttribute("aria-pressed", String(this.pinned));
        toolbarButton(t("Switch related tag layout"), this.layout === "Horizontal" ? "☷" : "▦", () => {
            this.layout = this.layout === "Horizontal" ? "Vertical" : "Horizontal";
            this.render();
        });
        toolbarButton(t("Close"), "×", () => this.hide());
        this.panel.appendChild(header);
        this.list = document.createElement("div");
        this.list.className = "ac-related-list";
        if (message) {
            const status = document.createElement("div");
            status.className = "ac-related-status";
            status.textContent = message;
            this.list.appendChild(status);
        }
        this.results.forEach((tag, index) => {
            const row = document.createElement("div");
            row.className = "ac-related-row";
            row.classList.toggle("ac-related-existing", !!findRelatedTagInPrompt(this.target.value, tag.name));
            const button = document.createElement("button");
            button.type = "button";
            button.className = "ac-related-tag";
            const label = document.createElement("span");
            label.className = "ac-related-name";
            label.style.color = `var(--ac-cat-${categoryColors[tag.category] || "general"})`;
            label.textContent = tag.name.replace(/_/g, " ");
            button.appendChild(label);
            const translation = this.translation(tag.name);
            if (translation) {
                const subtitle = document.createElement("small");
                subtitle.textContent = translation;
                button.appendChild(subtitle);
            }
            row.title = t("Shared posts: {count}; similarity: {score}%", { count: tag.cooccurrence.toLocaleString(), score: (100 * tag.similarity).toFixed(2) });
            if (row.classList.contains("ac-related-existing")) row.title += " · " + t("Already in prompt; click to select");
            button.addEventListener("click", () => this.insert(tag));
            button.addEventListener("mouseenter", () => { this.selectedIndex = index; this.updateSelection(false); });
            row.appendChild(button);
            if (settingValues.showWikiLinks) {
                const wiki = document.createElement("a");
                wiki.className = "ac-related-wiki";
                wiki.textContent = t("wiki");
                wiki.title = t("Open Danbooru Wiki Page");
                wiki.href = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(normalizeRelatedTag(tag.name))}`;
                wiki.target = "_blank";
                wiki.rel = "noopener noreferrer";
                row.appendChild(wiki);
            }
            this.list.appendChild(row);
        });
        this.panel.appendChild(this.list);
        const footer = document.createElement("small");
        footer.className = "ac-related-footer";
        footer.textContent = t("↑/↓ select · Enter/Tab insert · Esc close · gray tags are already in prompt");
        this.panel.appendChild(footer);
        this.updateSelection(false);
        this.updatePosition();
    }

    updateSelection(scroll = true) {
        const rows = this.list.querySelectorAll(".ac-related-row");
        rows.forEach((row, index) => {
            row.classList.toggle("ac-related-selected", index === this.selectedIndex);
            row.querySelector("button").setAttribute("aria-pressed", String(index === this.selectedIndex));
        });
        if (scroll) rows[this.selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    updatePosition() {
        if (!this.visible || !this.target) return;
        if (!this.target.isConnected) { this.hide(); return; }
        const caret = getFixedCaretCoordinates(this.target, this.source.start);
        const panel = this.panel.getBoundingClientRect();
        const margin = 8;
        const below = caret.bottom + margin;
        const top = below + panel.height <= window.innerHeight ? below : Math.max(margin, caret.top - panel.height - margin);
        this.panel.style.left = `${Math.max(margin, Math.min(caret.left, window.innerWidth - panel.width - margin))}px`;
        this.panel.style.top = `${Math.min(top, Math.max(margin, window.innerHeight - panel.height - margin))}px`;
    }

    insert(tag) {
        if (!this.isEnabled(this.target)) { this.hide(); return; }
        const target = this.target;
        const existing = findRelatedTagInPrompt(target.value, tag.name);
        target.focus();
        if (existing) {
            target.setSelectionRange(existing.start, existing.end);
        } else {
            const source = getRelatedTagAtCursor(target.value, this.source.start);
            if (!source || source.name !== this.source.name) { this.hide(); return; }
            const formatting = { ...getEffectiveFormattingSettings() };
            if (isKeepUnderscoresTextarea(target)) formatting.replaceUnderscore = false;
            let text = tag.name;
            if (formatting.replaceUnderscore) text = formatTagUnderscores(text, buildUnderscoreExclusionSet(formatting.formatKeepUnderscoresList));
            if (formatting.escapeParentheses) text = text.replace(/\\?([()[\]])/g, "\\$1");
            if (tag.category === 1 && this.engine.isAnimaWorkflowActive()) text = "@" + text;
            const insertion = buildRelatedInsertion(target.value, source, text, formatting);
            target.setSelectionRange(insertion.start, insertion.end);
            this.inserting = true;
            this.engine.isInserting = true;
            try {
                insertTextWithUndo(target, insertion.text, insertion.cursor, insertion.cursor);
            } finally {
                this.engine.isInserting = false;
                this.inserting = false;
            }
            this.engine.recordTagUsage(tag.name);
        }
        this.engine.hide();
        if (this.pinned) this.render();
        else this.hide();
    }
}
