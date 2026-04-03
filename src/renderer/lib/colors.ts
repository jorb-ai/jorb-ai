export const colors = {
  brand: '#290E99',
  brandSoft: 'rgba(41, 14, 153, 0.08)',
  brandText: '#290E99',

  border: '#e5e5ea',
  bgPanel: '#ffffff',
  bgSidebar: '#f7f7f8',
  bgApp: '#f4f5f7',

  textPrimary: '#1a1a1a',
  textSecondary: '#64646e',
  textMuted: '#a0a0ab',

  statusRunning: '#eab308',
  statusCompleted: '#22c55e',
  statusFailed: '#ef4444',
  statusStopped: '#f97316',
  statusQueued: '#9ca3af',
} as const;

export const statusBg: Record<string, string> = {
  queued: 'rgba(156, 163, 175, 0.12)',
  running: 'rgba(234, 179, 8, 0.14)',
  completed: 'rgba(34, 197, 94, 0.13)',
  failed: 'rgba(239, 68, 68, 0.12)',
  stopped: 'rgba(249, 115, 22, 0.12)',
};

export const statusText: Record<string, string> = {
  queued: '#6b7280',
  running: '#a16207',
  completed: '#15803d',
  failed: '#dc2626',
  stopped: '#c2410c',
};
