import type { AgentActivity, TaskStatus } from '@orchestrate/shared';

/**
 * Base: coolors dcdcdd-c5c3c6-46494c-4c5c68-1985a1 (platinum, silver, onyx, payne's gray, cerulean),
 * warmed with amber and vermilion so activity states never blur together.
 */
export const PALETTE = {
  platinum: '#dcdcdd',
  silver: '#c5c3c6',
  onyx: '#46494c',
  payne: '#4c5c68',
  cerulean: '#1985a1',
  ceruleanBright: '#3cc4e6',
  amber: '#f2a541',
  vermilion: '#e4572e',
  lavender: '#b8a9e3',
  green: '#7bc950',
  sand: '#f3d9b1',
  // materials
  limestone: '#d9d3c6',
  stone: '#c8c4bd',
  brick: '#b0715a',
  copper: '#6f9e8e',
  timber: '#8a5a3c',
  glass: '#1a2630',
  // park
  grassLight: '#a5bd88',
  grassDark: '#7d9a69',
  canopy: ['#6f9a5b', '#7fae68', '#5d8a52', '#8cb874', '#678f58', '#94b06a'],
  trunk: '#7a5a43',
  path: '#dcd5c6',
  weathered: '#9a917f',
  bare: '#8a8073',
  // scene
  skyTop: '#4a86a4',
  skyHorizon: '#e6ddd0',
  skyGlow: '#f7c48f',
  ground: '#cbc8c2',
  groundLine: '#c3bfb8',
  platformSide: '#4c5c68',
};

export const ACTIVITY_COLOR: Record<AgentActivity, string> = {
  idle: PALETTE.payne,
  working: PALETTE.amber,
  testing: PALETTE.ceruleanBright,
  reviewing: PALETTE.lavender,
  blocked: PALETTE.vermilion,
};

export const TASK_COLOR: Record<TaskStatus, string> = {
  pending: '#7d8790',
  red: PALETTE.cerulean,
  in_progress: '#d9861c',
  verifying: PALETTE.cerulean,
  review: '#7a68b8',
  merged: '#4f9a2b',
  escalated: PALETTE.vermilion,
  failed: PALETTE.vermilion,
  skipped: '#7d8790',
};
