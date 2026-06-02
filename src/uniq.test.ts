import { describe, expect, it } from 'vitest';
import { uniq } from './uniq';

describe('uniq', () => {
  it('keeps the first occurrence and drops later repeats', () => {
    expect(uniq(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('leaves an already-unique list (and the empty list) unchanged', () => {
    expect(uniq(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(uniq([])).toEqual([]);
  });
});
