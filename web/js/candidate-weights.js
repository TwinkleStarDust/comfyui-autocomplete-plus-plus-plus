import { settingValues } from "./settings.js";
import { formatWeight } from "./hotkeys.js";

export function canWeightCandidate(item) {
    return !item.type || ["artist", "trigger_word", "lora", "embeddings", "wildcard_item"].includes(item.type);
}

export function applyCandidateWeight(text, weight, type) {
    if (type === "lora") {
        return text.replace(/:([+-]?(?:\d+\.?\d*|\.\d+))>$/, `:${formatWeight(weight)}>`);
    }
    return weight === 1 ? text : `(${text}:${formatWeight(weight)})`;
}

export class CandidateWeights {
    constructor() {
        this.values = new Map();
    }

    key(item) { return `${item.type || "tag"}:${item.text ?? item.name}`; }
    clear() { this.values.clear(); }
    has(item) { return this.values.has(this.key(item)); }
    get(item) { return this.values.get(this.key(item)); }

    bind(row, item, initialWeight = 1) {
        if (!canWeightCandidate(item)) return;
        const badge = document.createElement("span");
        badge.className = "acCandidateWeight";
        const refresh = () => {
            badge.hidden = !this.has(item) || !settingValues.enableCandidateWeightWheel;
            badge.textContent = `×${formatWeight(this.get(item) ?? initialWeight)}`;
        };
        refresh();
        row.appendChild(badge);
        row.addEventListener("wheel", event => {
            if (!settingValues.enableCandidateWeightWheel || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
            const delta = event.deltaY || event.deltaX;
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            const step = Number(settingValues.candidateWeightWheelStep) || 0.05;
            const weight = (this.get(item) ?? initialWeight) + (delta < 0 ? step : -step);
            this.values.set(this.key(item), Number(weight.toFixed(6)));
            refresh();
        }, { passive: false });
    }
}
