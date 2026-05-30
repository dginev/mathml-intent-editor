import { stringify } from 'yaml';

/** Build a W3C-shaped `open.yml` document (`concepts: [{ title, intents }]`) from raw entries. */
export function w3cYaml(intents: Array<Record<string, unknown>>): string {
  return stringify({ concepts: [{ title: 'Open Concepts', intents }] });
}

/** A minimal W3C intent entry with sensible defaults; override/extend via `extra`. */
export function entry(concept: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { concept, mathml: [`<math><mi>${concept}</mi></math>`], ...extra };
}
