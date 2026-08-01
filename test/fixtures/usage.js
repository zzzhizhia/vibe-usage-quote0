export const todayUsage = {
  hasAnyData: true,
  buckets: [
    {
      bucketStart: '2026-07-30T00:00:00.000Z',
      source: 'Claude Code',
      model: 'opus',
      project: 'private-alpha',
      totalTokens: 1_000,
      cachedInputTokens: 9_000,
      estimatedCost: 0.1,
    },
    {
      bucketStart: '2026-07-30T01:00:00.000Z',
      source: 'Cursor',
      model: 'sonnet',
      project: 'private-beta',
      totalTokens: 2_000,
      cachedInputTokens: 0,
      estimatedCost: 0.2,
    },
    {
      bucketStart: '2026-07-30T02:00:00.000Z',
      source: 'Claude Code',
      model: 'haiku',
      project: 'private-alpha',
      totalTokens: 500,
      cachedInputTokens: 500,
      estimatedCost: 0.05,
    },
  ],
  sessions: [
    { firstMessageAt: '2026-07-30T00:15:00.000Z', activeSeconds: 1_800, project: 'private-alpha' },
    { firstMessageAt: '2026-07-30T01:15:00.000Z', activeSeconds: 900, project: 'private-beta' },
  ],
};

export const weekUsage = {
  hasAnyData: true,
  buckets: [
    {
      bucketStart: '2026-07-24T00:00:00.000Z',
      source: 'Claude Code',
      model: 'opus',
      project: 'private-alpha',
      totalTokens: 6_000,
      cachedInputTokens: 0,
      estimatedCost: 1.2,
    },
    {
      bucketStart: '2026-07-25T00:00:00.000Z',
      source: 'Cursor',
      model: 'sonnet',
      project: 'private-beta',
      totalTokens: 8_000,
      cachedInputTokens: 1_000,
      estimatedCost: 0.8,
    },
    {
      bucketStart: '2026-07-26T00:00:00.000Z',
      source: 'Copilot',
      model: 'gpt',
      project: 'private-gamma',
      totalTokens: 3_000,
      cachedInputTokens: 20_000,
      estimatedCost: 0.3,
    },
    {
      bucketStart: '2026-07-27T00:00:00.000Z',
      source: 'Claude Code',
      model: 'sonnet',
      project: 'private-alpha',
      totalTokens: 5_000,
      cachedInputTokens: 0,
      estimatedCost: 0.5,
    },
    {
      bucketStart: '2026-07-28T00:00:00.000Z',
      source: 'Aider',
      model: 'deepseek',
      project: 'private-delta',
      totalTokens: 7_000,
      cachedInputTokens: 0,
      estimatedCost: 0.2,
    },
    {
      bucketStart: '2026-07-29T00:00:00.000Z',
      source: 'Continue',
      model: 'llama',
      project: 'private-epsilon',
      totalTokens: 1_000,
      cachedInputTokens: 0,
      estimatedCost: 0.01,
    },
  ],
  sessions: [
    { firstMessageAt: '2026-07-24T00:15:00.000Z', activeSeconds: 3_600, project: 'private-alpha' },
    { firstMessageAt: '2026-07-25T00:15:00.000Z', activeSeconds: 1_800, project: 'private-beta' },
    { firstMessageAt: '2026-07-26T00:15:00.000Z', activeSeconds: 600, project: 'private-gamma' },
    { firstMessageAt: '2026-07-27T00:15:00.000Z', activeSeconds: 0, project: 'private-delta' },
  ],
};

export const emptyUsage = {
  hasAnyData: false,
  buckets: [],
  sessions: [],
};
