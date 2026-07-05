import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';

const componentsDir = fileURLToPath(new URL('../components', import.meta.url));
const KEY_CALL = /\$_\(\s*'([^']+)'\s*\)|\$_\(\s*"([^"]+)"\s*\)|labelKey:\s*'([^']+)'|labelKey:\s*"([^"]+)"|titleKey:\s*'([^']+)'/g;
const DYNAMIC_FAMILIES: { pattern: RegExp; family: (key: string) => boolean }[] = [
    { pattern: /adjustments\.\$\{/, family: (key) => key.startsWith('adjustments.') },
    { pattern: /filters\.\$\{/, family: (key) => key.startsWith('filters.') },
];

function collectStaticKeys(): { keys: Set<string>; sources: string[] } {
    const keys = new Set<string>();
    const sources: string[] = [];
    for (const file of readdirSync(componentsDir)) {
        if (!file.endsWith('.svelte')) continue;
        const content = readFileSync(join(componentsDir, file), 'utf8');
        sources.push(content);
        KEY_CALL.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = KEY_CALL.exec(content)) !== null) {
            const key = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
            if (key && key.includes('.')) keys.add(key);
        }
    }
    return { keys, sources };
}

describe('dictionary key integrity', () => {
    const enKeys = new Set(Object.keys(en));
    const { keys: usedKeys, sources } = collectStaticKeys();

    test('dictionaries are flat string maps with identical key sets', () => {
        for (const value of [...Object.values(en), ...Object.values(ja)]) {
            expect(typeof value).toBe('string');
        }
        expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    });

    test('every statically referenced key exists in en.json', () => {
        const missing = [...usedKeys].filter((key) => !enKeys.has(key));
        expect(missing).toEqual([]);
    });

    test('dynamic key families used in components resolve against the dictionary', () => {
        const corpus = sources.join('\n');
        for (const { pattern, family } of DYNAMIC_FAMILIES) {
            if (pattern.test(corpus)) {
                expect([...enKeys].some(family)).toBe(true);
            }
        }
        expect(sources.some((s) => s.includes('adjustments.hsl.'))).toBe(false);
    });
});
