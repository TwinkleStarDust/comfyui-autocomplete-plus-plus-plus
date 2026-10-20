import { t } from "./i18n.js";

export const ffdkjFilename = "danbooru_ffdkj.csv";
const basePath = "/autocomplete-plus-plus/dictionary/";
const busyStates = new Set(["checking", "downloading", "converting"]);
const panels = new Map();
let currentStatus = { state: "loading", installed: false };
let revision;
let onUpdated;
let pollTimer;
let started = false;
let pending = 0;

function renderPanels() {
    for (const [panel, render] of panels) {
        if (panel.isConnected) panel.dataset.mounted = "true";
        if (!panel.isConnected && panel.dataset.mounted) panels.delete(panel);
        else render();
    }
}

async function request(action, payload) {
    pending++;
    renderPanels();
    try {
        const response = await fetch(basePath + action, {
            method: action === "status" ? "GET" : "POST",
            cache: "no-store",
            ...(payload ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            } : {})
        });
        if (!response.ok) {
            throw new Error(response.status === 404 || response.status === 405
                ? t("Restart ComfyUI to load the dictionary updater.")
                : `HTTP ${response.status}`);
        }
        const status = await response.json();
        const installedRevision = status.installed ? `${status.revision}:${status.last_updated}` : null;
        const changed = installedRevision && revision !== undefined && revision !== installedRevision;
        revision = installedRevision;
        currentStatus = status;
        if (changed && onUpdated) await onUpdated(status);
        return true;
    } catch (error) {
        currentStatus = { ...currentStatus, state: "error", error: error.message };
        return false;
    } finally {
        pending--;
        renderPanels();
        if (busyStates.has(currentStatus.state) && !pollTimer) {
            pollTimer = setTimeout(() => {
                pollTimer = null;
                void request("status");
            }, 1000);
        }
    }
}

export function startDictionaryUpdates(onDictionaryUpdated) {
    if (started) return;
    started = true;
    onUpdated = onDictionaryUpdated;
    void request("status").then(ready => { if (ready) void request("ensure"); });
    setInterval(() => { void request("ensure"); }, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void request("ensure");
    });
}

export function createDictionaryUpdaterPanel(onUse) {
    const panel = document.createElement("div");
    panel.className = "flex flex-col gap-3";
    panel.style.cssText = "max-width:560px;padding:12px;border-radius:8px;background:var(--comfy-input-bg);box-shadow:inset 0 1px 0 #ffffff08;";

    const description = document.createElement("span");
    description.className = "text-sm text-muted";
    description.textContent = t("Download ffdkj Chinese tags for local autocomplete. Updates follow the latest GitHub release.");
    const source = document.createElement("a");
    source.href = "https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/releases";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = t("View Data Source ↗");

    const status = document.createElement("span");
    status.className = "text-sm";
    status.setAttribute("role", "status");
    status.style.overflowWrap = "anywhere";
    const details = document.createElement("span");
    details.className = "text-xs text-muted";
    details.style.whiteSpace = "pre-line";
    const note = document.createElement("span");
    note.className = "text-sm text-muted";
    note.setAttribute("role", "status");

    const automaticLabel = document.createElement("label");
    automaticLabel.className = "flex items-center gap-2 text-sm";
    const automatic = document.createElement("input");
    automatic.type = "checkbox";
    const automaticText = document.createElement("span");
    automaticText.textContent = t("Automatically install and update daily");
    automaticLabel.append(automatic, automaticText);
    automatic.addEventListener("change", async () => {
        const saved = await request("configure", { auto_update: automatic.checked });
        if (saved && currentStatus.auto_update) await request("ensure");
    });

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap gap-2";
    const makeButton = (text, action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "p-button p-component rounded-md px-3 py-1.5 text-sm";
        button.textContent = t(text);
        button.addEventListener("click", () => { note.textContent = ""; void action(); });
        actions.appendChild(button);
        return button;
    };
    const check = makeButton("Check for Updates", () => request("check"));
    const update = makeButton("Install / Update", () => request("update"));
    const repair = makeButton("Download Again", () => request("repair"));
    const use = makeButton("Use This Dictionary", async () => {
        try {
            await onUse(ffdkjFilename);
            note.textContent = t("Dictionary selected. Set canvas dictionary controllers to follow global settings if needed.");
        } catch (error) {
            note.textContent = error.message;
        }
    });

    panels.set(panel, () => {
        const data = currentStatus;
        const busy = pending > 0 || busyStates.has(data.state);
        const labels = {
            loading: "Loading dictionary status…",
            missing: "Not installed",
            checking: "Checking for updates…",
            downloading: "Downloading dictionary…",
            converting: "Preparing dictionary…",
            ready: data.update_available ? "A dictionary update is available" : "Dictionary is up to date"
        };
        status.textContent = data.state === "error"
            ? t("Dictionary update failed: {error}", { error: data.error })
            : t(labels[data.state] || "Not installed");
        if (data.state === "downloading" && data.total_bytes) {
            status.textContent += ` ${Math.floor(data.downloaded_bytes / data.total_bytes * 100)}%`;
        }
        details.textContent = [
            data.installed ? `${data.filename} · ${data.version || ""} · ${t("{count} tags", { count: Number(data.row_count).toLocaleString() })}` : "",
            data.last_checked ? t("Last checked: {time}", { time: new Date(data.last_checked * 1000).toLocaleString() }) : "",
            data.last_updated ? t("Last updated: {time}", { time: new Date(data.last_updated * 1000).toLocaleString() }) : ""
        ].filter(Boolean).join("\n");
        automatic.checked = !!data.auto_update;
        automatic.disabled = pending > 0;
        check.disabled = update.disabled = busy;
        repair.disabled = use.disabled = busy || !data.installed;
    });
    panel.append(description, source, status, details, automaticLabel, actions, note);
    panels.get(panel)();
    void request("status");
    return panel;
}
