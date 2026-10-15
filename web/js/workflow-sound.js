import { api } from "/scripts/api.js";

let audioContext = null;
let initialized = false;
const playbackRate = 1.5;

export const workflowSounds = [
    {
        value: "Ding", name: "Clear Double Chime (Original)", waveform: "sine",
        notes: [[0, 880, 0.2], [0.22, 1174.66, 0.28]],
    },
    {
        value: "Bell", name: "Soft Bell", waveform: "sine",
        notes: [[0, 659.25, 0.95, 0.9], [0, 1318.51, 0.65, 0.26], [0, 1977.77, 0.4, 0.12]],
    },
    {
        value: "Arpeggio", name: "Success Arpeggio", waveform: "triangle",
        notes: [[0, 523.25, 0.16, 0.9], [0.16, 659.25, 0.16, 0.9], [0.32, 783.99, 0.16, 0.9], [0.48, 1046.5, 0.32]],
    },
    {
        value: "Digital", name: "Digital Triple Beep", waveform: "square",
        notes: [[0, 740, 0.105, 0.4], [0.17, 740, 0.105, 0.4], [0.34, 987.77, 0.2, 0.4]],
    },
];

async function unlockAudio() {
    if (!audioContext || audioContext.state === "closed") {
        audioContext = new window.AudioContext();
    }
    if (audioContext.state !== "running") {
        await audioContext.resume();
    }
}

function playSound(volume, style = "Ding") {
    const level = Math.min(100, Math.max(0, Number(volume))) / 100;
    if (!Number.isFinite(level) || level === 0 || audioContext?.state !== "running") return false;

    const now = audioContext.currentTime + 0.01;
    const sound = workflowSounds.find(item => item.value === style) || workflowSounds[0];
    for (const [offset, frequency, duration, strength = 1] of sound.notes) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = now + offset / playbackRate;
        oscillator.type = sound.waveform;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(level * 0.6 * strength, start + 0.01 / playbackRate);
        gain.gain.exponentialRampToValueAtTime(0.0003 * strength, start + duration / playbackRate);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + (duration + 0.01) / playbackRate);
    }
    return true;
}

export async function previewWorkflowSound(volume, style = "Ding") {
    await unlockAudio();
    return playSound(volume, style);
}

export function setupWorkflowSound(settings) {
    if (initialized) return;
    initialized = true;
    const completedPrompts = new Set();

    // Audio must be unlocked by a real user gesture, before a task finishes.
    const onGesture = (event) => {
        if (!event.isTrusted || !settings.workflowCompletionSound || Number(settings.workflowSoundVolume) <= 0) return;
        if (audioContext?.state === "running") return;
        unlockAudio().catch(() => {});
    };
    document.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
    document.addEventListener("keydown", onGesture, { capture: true });

    api.addEventListener("execution_success", ({ detail }) => {
        const promptId = detail?.prompt_id;
        if (!promptId || completedPrompts.has(promptId)) return;
        completedPrompts.add(promptId);
        if (completedPrompts.size > 256) completedPrompts.delete(completedPrompts.values().next().value);
        if (!settings.workflowCompletionSound) return;
        try {
            playSound(settings.workflowSoundVolume, settings.workflowSoundStyle);
        } catch (error) {
            console.warn("[Autocomplete+++] Unable to play workflow completion sound:", error);
        }
    });
}
