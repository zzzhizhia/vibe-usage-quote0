export const todayUsage = {
  hasAnyData: true,
  buckets: [
    { source: 'Claude Code', model: 'opus', project: 'private-alpha', totalTokens: 1_000, estimatedCost: 0.1 },
    { source: 'Cursor', model: 'sonnet', project: 'private-beta', totalTokens: 2_000, estimatedCost: 0.2 },
    { source: 'Claude Code', model: 'haiku', project: 'private-alpha', totalTokens: 500, estimatedCost: 0.05 },
  ],
  sessions: [
    { activeSeconds: 1_800, project: 'private-alpha' },
    { activeSeconds: 900, project: 'private-beta' },
  ],
};

export const weekUsage = {
  hasAnyData: true,
  buckets: [
    { source: 'Claude Code', model: 'opus', project: 'private-alpha', totalTokens: 6_000, estimatedCost: 1.2 },
    { source: 'Cursor', model: 'sonnet', project: 'private-beta', totalTokens: 8_000, estimatedCost: 0.8 },
    { source: 'Copilot', model: 'gpt', project: 'private-gamma', totalTokens: 3_000, estimatedCost: 0.3 },
    { source: 'Claude Code', model: 'sonnet', project: 'private-alpha', totalTokens: 5_000, estimatedCost: 0.5 },
    { source: 'Aider', model: 'deepseek', project: 'private-delta', totalTokens: 7_000, estimatedCost: 0.2 },
    { source: 'Continue', model: 'llama', project: 'private-epsilon', totalTokens: 1_000, estimatedCost: 0.01 },
  ],
  sessions: [
    { activeSeconds: 3_600, project: 'private-alpha' },
    { activeSeconds: 1_800, project: 'private-beta' },
    { activeSeconds: 600, project: 'private-gamma' },
    { activeSeconds: 0, project: 'private-delta' },
  ],
};

export const emptyUsage = {
  hasAnyData: false,
  buckets: [],
  sessions: [],
};
