export type KeyLayout = 'WASD' | 'ZQSD';

export interface KeyBindMap {
  forward: string[];
  backward: string[];
  left: string[];
  right: string[];
  jump: string[];
  dash: string[];
}

export interface HudState {
  stageName: string;
  stageIndex: number;
  shardsCollected: number;
  totalShards: number;
  elapsedMs: number;
  falls: number;
  speed: number;
  canAirDash: boolean;
  isGliding: boolean;
  ascendantUnlocked: boolean;
  isFirstPerson: boolean;
  isPaused: boolean;
  hasStarted: boolean;
  touchVisible: boolean;
  victoryTriggered: boolean;
  bestTimeMs: number | null;
}

export interface VictorySummary {
  elapsedMs: number;
  bestTimeMs: number;
  isNewBest: boolean;
  falls: number;
  shardsCollected: number;
  totalShards: number;
  ascendantUnlocked: boolean;
}

export interface GameSettings {
  sensitivity: number;
  baseFov: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

export interface EngineCallbacks {
  onHudUpdate: (state: HudState) => void;
  onToast: (message: string, tone?: 'info' | 'shard' | 'victory' | 'warn') => void;
  onVictory: (summary: VictorySummary) => void;
  onWebglError: (message: string) => void;
}
