import { describe, expect, it } from 'vitest';

import { presenceTimeoutSeconds } from './presence.js';

describe('presence timeout', () => {
  it('uses the 15 second floor for slow sample rates', () => {
    expect(presenceTimeoutSeconds(1)).toBe(15);
    expect(presenceTimeoutSeconds(5)).toBe(15);
  });

  it('uses three sample intervals at the boundary', () => {
    expect(presenceTimeoutSeconds(6)).toBe(18);
    expect(presenceTimeoutSeconds(10)).toBe(30);
  });

  it('scales with the maximum sample rate', () => {
    expect(presenceTimeoutSeconds(255)).toBe(765);
  });
});
