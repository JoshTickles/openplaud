/**
 * Voiceprint names are matched on a normalised form so that "Hara-San" and
 * "Hara-san" are one person rather than two half-trained voices. The display
 * name keeps whatever casing the user typed; only lookups are normalised.
 */
export function normalizeVoiceprintName(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when two names refer to the same library entry. */
export function isSameVoiceprintName(a: string, b: string): boolean {
    return normalizeVoiceprintName(a) === normalizeVoiceprintName(b);
}

/**
 * Pass-through labels like "Speaker 1" are not names and must never become
 * voiceprints, or every unnamed speaker would train a single junk voice.
 */
export function isPlaceholderSpeakerName(name: string): boolean {
    return /^speaker\s*\d+$/i.test(name.trim());
}

/**
 * Suggest library names for what the user is typing: prefix matches first,
 * then substring matches, each alphabetical. Case- and whitespace-insensitive.
 */
export function suggestNames(
    input: string,
    known: readonly string[],
    limit = 8,
): string[] {
    const sorted = [...known].sort((a, b) => a.localeCompare(b));
    const q = normalizeVoiceprintName(input);
    if (q.length === 0) return sorted.slice(0, limit);

    const prefix: string[] = [];
    const contains: string[] = [];
    for (const name of sorted) {
        const n = normalizeVoiceprintName(name);
        if (n === q) continue;
        if (n.startsWith(q)) prefix.push(name);
        else if (n.includes(q)) contains.push(name);
    }
    return [...prefix, ...contains].slice(0, limit);
}
