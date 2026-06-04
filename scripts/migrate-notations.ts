/**
 * One-time `notations:` migration — rewrites an `open.yml`-shaped file from the old rendering keys
 * (`mathml:` list + scalar `tex:`) to the new `notations:` list of `{tex?, mathml}` hashes, using the
 * editor's OWN parse → serialize pipeline. That makes the output byte-identical to what the editor
 * would emit, so the first post-migration Save stays a minimal diff (exactly like the original
 * canonical lint). Legacy free-text `notation`/`notationa`/`notationb` keys round-trip untouched.
 *
 * Usage:  npx vite-node scripts/migrate-notations.ts -- <in.yml> [out.yml]
 * (omit out.yml to rewrite in place; the parser also accepts already-migrated input — idempotent)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDictionary } from '../src/data/parse';
import { serializeConcepts } from '../src/data/serialize';

const [input, output = input] = process.argv.slice(2).filter((a) => a !== '--');
if (!input) {
  console.error('usage: npx vite-node scripts/migrate-notations.ts -- <in.yml> [out.yml]');
  process.exit(1);
}

const before = readFileSync(input, 'utf8');
const concepts = parseDictionary(before);
const after = serializeConcepts(concepts);
writeFileSync(output, after);

const changed = after !== before;
console.log(
  `${input} → ${output}: ${concepts.length} concepts, ${changed ? 'migrated' : 'already canonical (no change)'}`,
);
