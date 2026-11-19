import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  Eye,
  Flag,
  Gift,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { ZephyrEngine } from './game/engine';
import { GameSettings, HudState, KeyLayout, VictorySummary } from './game/types';

type ActiveModal = 'none' | 'codes' | 'controls' | 'pause' | 'victory';

interface ToastState {
  message: string;
  tone: 'info' | 'shard' | 'victory' | 'warn';
  visible: boolean;
}

const INITIAL_HUD: HudState = {
  stageName: 'Stage 1: Aether Sanctuary',
  stageIndex: 0,
  shardsCollected: 0,
  totalShards: 4,
  elapsedMs: 0,
  falls: 0,
  speed: 0,
  canAirDash: true,
  isGliding: false,
  ascendantUnlocked: false,
  isFirstPerson: false,
  isPaused: false,
  hasStarted: false,
  touchVisible: false,
  victoryTriggered: false,
  bestTimeMs: null,
};

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ZephyrEngine | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [keyLayout, setKeyLayout] = useState<KeyLayout>('WASD');
  const [codeValue, setCodeValue] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [victorySummary, setVictorySummary] = useState<VictorySummary | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings>({
    sensitivity: 1.0,
    baseFov: 65,
    musicEnabled: true,
    sfxEnabled: true,
  });

  const [toast, setToast] = useState<ToastState>({
    message: '',
    tone: 'info',
    visible: false,
  });

  // Virtual touch joystick refs
  const stickZoneRef = useRef<HTMLDivElement | null>(null);
  const stickKnobRef = useRef<HTMLDivElement | null>(null);
  const stickTouchIdRef = useRef<number | null>(null);
  const lookTouchesRef = useRef<Record<number, { x: number; y: number }>>({});

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ message, tone, visible: true });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new ZephyrEngine(mount, {
      onHudUpdate: (nextState) => {
        setHud(nextState);
        if (nextState.isPaused && nextState.hasStarted) {
          setActiveModal((curr) => (curr === 'none' ? 'pause' : curr));
        } else if (!nextState.isPaused) {
          setActiveModal((curr) => (curr === 'pause' ? 'none' : curr));
        }
      },
      onToast: showToast,
      onVictory: (summary) => {
        setVictorySummary(summary);
        setActiveModal('victory');
      },
      onWebglError: (msg) => setWebglError(msg),
    });

    engineRef.current = engine;

    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [showToast]);

  const openModal = (modal: ActiveModal) => {
    setActiveModal(modal);
    engineRef.current?.setModalBlocked(modal !== 'none');
  };

  const closeModal = () => {
    setActiveModal('none');
    engineRef.current?.setModalBlocked(false);
    if (hud.isPaused) {
      engineRef.current?.setPaused(false);
    }
  };

  const handleStartGame = () => {
    engineRef.current?.startGame();
  };

  const handleLayoutChange = (layout: KeyLayout) => {
    setKeyLayout(layout);
    engineRef.current?.setKeyLayout(layout);
  };

  const handleSettingChange = (patch: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      engineRef.current?.updateSettings(next);
      return next;
    });
  };

  const handleRedeemCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    const ok = engineRef.current?.redeemCode(codeValue) ?? false;
    if (ok) {
      setCodeValue('');
      setCodeError(false);
      closeModal();
    } else {
      setCodeError(true);
      window.setTimeout(() => setCodeError(false), 750);
    }
  };

  const handleResetRun = () => {
    setVictorySummary(null);
    setActiveModal('none');
    engineRef.current?.setModalBlocked(false);
    engineRef.current?.resetFullRun();
  };

  // Touch joystick & look handlers
  const handleStickTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches[0];
    if (!touch) return;
    stickTouchIdRef.current = touch.identifier;
  };

  const handleTouchLayerMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (activeModal !== 'none') return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === stickTouchIdRef.current && stickZoneRef.current && stickKnobRef.current) {
        const rect = stickZoneRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const maxR = rect.width / 2;
        if (dist > maxR) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }
        stickKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        engineRef.current?.setVirtualAxis(dx / maxR, dy / maxR);
      } else if (t.clientX > window.innerWidth * 0.45) {
        const prev = lookTouchesRef.current[t.identifier];
        if (prev) {
          engineRef.current?.applyTouchLook(t.clientX - prev.x, t.clientY - prev.y);
        }
        lookTouchesRef.current[t.identifier] = { x: t.clientX, y: t.clientY };
      }
    }
  };

  const handleTouchLayerEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === stickTouchIdRef.current) {
        stickTouchIdRef.current = null;
        if (stickKnobRef.current) {
          stickKnobRef.current.style.transform = 'translate(0px, 0px)';
        }
        engineRef.current?.setVirtualAxis(0, 0);
      }
      delete lookTouchesRef.current[t.identifier];
    }
  };

  const toastToneStyle =
    toast.tone === 'victory'
      ? 'border-amber-400 text-amber-200 bg-[#141006]/95'
      : toast.tone === 'shard'
        ? 'border-rose-400 text-rose-200 bg-[#190a14]/95'
        : toast.tone === 'warn'
          ? 'border-red-400 text-red-200 bg-[#1b090c]/95'
          : 'border-cyan-400/70 text-cyan-200 bg-[#071322]/95';

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#081222]">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={canvasMountRef} className="absolute inset-0 z-0" />

      {/* Error Banner */}
      {webglError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg bg-red-600 text-white text-sm font-semibold shadow-lg">
          {webglError}
        </div>
      )}

      {/* Aim Reticle: Shown ONLY in 1st Person mode during active play */}
      {hud.hasStarted && hud.isFirstPerson && !hud.isPaused && activeModal === 'none' && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-2 h-2 rounded-full border transition-transform duration-150 ${
            hud.canAirDash
              ? 'bg-cyan-300 border-white shadow-[0_0_8px_rgba(34,211,238,0.9)] scale-100'
              : 'bg-slate-400/60 border-slate-300/60 scale-75'
          }`}
        />
      )}

      {/* Top HUD Bar */}
      <header
        data-ui-interactive="true"
        className="pointer-events-none fixed top-0 inset-x-0 z-20 flex flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4"
      >
        <div className="pointer-events-auto flex items-center gap-4 bg-[#071120]/85 border border-white/12 rounded-lg px-4 py-2">
          <span className="font-display text-lg sm:text-xl font-extrabold tracking-wider text-white whitespace-nowrap">
            ZEPHYR
          </span>
          <span className="hidden md:inline text-white/25" aria-hidden="true">
            ·
          </span>
          <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-200 whitespace-nowrap">
            <span className="font-semibold text-cyan-300">{hud.stageName}</span>
            <span className="text-white/30" aria-hidden="true">
              /
            </span>
            <span className="tabular-nums">
              Shards{' '}
              <strong className={hud.ascendantUnlocked ? 'text-amber-300' : 'text-rose-300'}>
                {hud.shardsCollected}/{hud.totalShards}
              </strong>
            </span>
            <span className="text-white/30 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="font-display tabular-nums text-white hidden sm:inline">
              {formatTime(hud.elapsedMs)}
            </span>
            <span className="text-white/30 hidden lg:inline" aria-hidden="true">
              ·
            </span>
            <span className="tabular-nums text-slate-300 hidden lg:inline">
              Falls {hud.falls}
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSettingChange({ musicEnabled: !settings.musicEnabled })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#071120]/85 border border-white/15 text-xs font-semibold text-slate-100 hover:border-cyan-400/70 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Toggle background music"
          >
            {settings.musicEnabled ? <Volume2 className="w-4 h-4 text-cyan-300" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
            <span className="hidden sm:inline">{settings.musicEnabled ? 'Music On' : 'Muted'}</span>
          </button>

          <button
            type="button"
            onClick={() => openModal('controls')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#071120]/85 border border-white/15 text-xs font-semibold text-slate-100 hover:border-cyan-400/70 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Keyboard className="w-4 h-4 text-cyan-300" />
            <span>{keyLayout}</span>
          </button>

          <button
            type="button"
            onClick={() => openModal('codes')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#071120]/85 border border-white/15 text-xs font-semibold text-slate-100 hover:border-cyan-400/70 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Gift className="w-4 h-4 text-amber-300" />
            <span className="hidden sm:inline">Codes</span>
          </button>

          <button
            type="button"
            onClick={() => engineRef.current?.toggleCameraView()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#071120]/85 border border-white/15 text-xs font-semibold text-slate-100 hover:border-cyan-400/70 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Eye className="w-4 h-4 text-cyan-300" />
            <span className="hidden md:inline">{hud.isFirstPerson ? '1st Person' : '3rd Person'}</span>
          </button>

          {hud.hasStarted && (
            <button
              type="button"
              onClick={() => engineRef.current?.setPaused(!hud.isPaused)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#071120]/85 border border-white/15 text-xs font-semibold text-slate-100 hover:border-cyan-400/70 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Pause & Settings (Esc)"
            >
              <Pause className="w-4 h-4 text-cyan-300" />
              <span className="hidden sm:inline">Menu</span>
            </button>
          )}
        </div>
      </header>

      {/* Bottom Flight Status Strip (Quiet, Unboxed Velocity & Ability Readout) */}
      {hud.hasStarted && !hud.touchVisible && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 px-4 py-1.5 rounded-lg bg-[#071120]/80 border border-white/10 text-xs text-slate-200 whitespace-nowrap">
          <span className="font-display tabular-nums">
            {hud.speed.toFixed(1)} <span className="text-slate-400">m/s</span>
          </span>
          <span className="text-white/25" aria-hidden="true">
            ·
          </span>
          <span className={hud.ascendantUnlocked ? 'text-amber-300 font-semibold' : hud.canAirDash ? 'text-cyan-300 font-semibold' : 'text-slate-400'}>
            {hud.ascendantUnlocked ? 'Infinite Dash' : hud.canAirDash ? 'Air Dash Ready' : 'Dash Recharging'}
          </span>
          <span className="text-white/25" aria-hidden="true">
            ·
          </span>
          <span className={hud.isGliding ? 'text-sky-300 font-semibold' : 'text-slate-400'}>
            {hud.isGliding ? 'Wind Gliding' : 'Hold Space in Air to Glide'}
          </span>
        </div>
      )}

      {/* Non-overlapping Toast Notification */}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-30 px-5 py-2.5 rounded-lg border text-sm font-semibold shadow-xl transition-all duration-200 whitespace-nowrap ${toastToneStyle} ${
          toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
      >
        {toast.message}
      </div>

      {/* Dynamic Touch Controls Layer (Shown ONLY after actual touch input or manual toggle) */}
      {hud.hasStarted && hud.touchVisible && activeModal === 'none' && (
        <div
          data-ui-interactive="true"
          onTouchMove={handleTouchLayerMove}
          onTouchEnd={handleTouchLayerEnd}
          onTouchCancel={handleTouchLayerEnd}
          className="fixed inset-0 z-20 pointer-events-auto"
        >
          <div
            ref={stickZoneRef}
            onTouchStart={handleStickTouchStart}
            className="absolute bottom-7 left-6 w-28 h-28 rounded-full bg-[#071120]/70 border-2 border-white/30 flex items-center justify-center touch-none"
          >
            <div ref={stickKnobRef} className="w-11 h-11 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)] pointer-events-none" />
          </div>

          <div className="absolute bottom-7 right-5 flex items-center gap-3">
            <button
              type="button"
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                engineRef.current?.triggerDash();
              }}
              className="w-16 h-16 rounded-full bg-[#071120]/85 border-2 border-cyan-400 text-xs font-bold text-white active:bg-cyan-400 active:text-slate-950"
            >
              DASH
            </button>
            <button
              type="button"
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                engineRef.current?.setTouchJump(true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                engineRef.current?.setTouchJump(false);
              }}
              onTouchCancel={() => engineRef.current?.setTouchJump(false)}
              className="w-16 h-16 rounded-full bg-[#071120]/85 border-2 border-amber-400 text-xs font-bold text-white active:bg-amber-400 active:text-slate-950"
            >
              JUMP
            </button>
          </div>
        </div>
      )}

      {/* Entrance Overlay */}
      {!hud.hasStarted && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-40 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#060f1d]/75 via-[#071324]/82 to-[#040a14]/92"
        >
          <div className="max-w-lg w-full text-center">
            <p className="text-xs font-semibold tracking-widest uppercase text-cyan-300 mb-2">
              Isles of Velocity
            </p>
            <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-4">
              ZEPHYR
            </h1>
            <p className="text-sm sm:text-base text-slate-200 leading-relaxed mb-7">
              Leap across six vertical sky stages, ride updraft columns, glide on the wind, and gather all 4 Echo Shards to awaken Golden Seraph Wings.
            </p>

            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-left text-xs sm:text-sm bg-[#09172b]/90 border border-white/12 rounded-xl p-5 mb-7">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Move</span>
                <span className="font-mono text-cyan-300 font-semibold">{keyLayout} / Arrows</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Jump & Glide</span>
                <span className="font-mono text-cyan-300 font-semibold">Space (Hold)</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Air Dash</span>
                <span className="font-mono text-cyan-300 font-semibold">Shift</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Camera View</span>
                <span className="font-mono text-cyan-300 font-semibold">V / C</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Respawn</span>
                <span className="font-mono text-cyan-300 font-semibold">R</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300">Pause Menu</span>
                <span className="font-mono text-cyan-300 font-semibold">Esc</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartGame}
              className="inline-flex items-center justify-center gap-2.5 px-9 py-3.5 rounded-xl bg-cyan-400 text-slate-950 font-display text-base font-extrabold tracking-wide hover:bg-cyan-300 active:scale-[0.98] transition-all cursor-pointer shadow-[0_8px_28px_rgba(34,211,238,0.35)]"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Enter the Skies</span>
            </button>

            {hud.bestTimeMs !== null && (
              <p className="mt-4 text-xs text-slate-300 tabular-nums">
                Personal Best: <span className="font-semibold text-amber-300">{formatTime(hud.bestTimeMs)}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Secret Codes Modal */}
      {activeModal === 'codes' && (
        <div
          data-ui-interactive="true"
          onClick={closeModal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#040a14]/80"
        >
          <form
            onSubmit={handleRedeemCode}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#0a182d] border border-white/15 rounded-2xl p-6 text-slate-100 shadow-2xl"
          >
            <h2 className="font-display text-xl font-bold text-white mb-1">Secret Codes</h2>
            <p className="text-sm text-slate-300 mb-5">
              Enter <span className="font-mono text-cyan-300">SECRET_CODE</span> to warp to the Celestial Spire, or{' '}
              <span className="font-mono text-amber-300">ASCEND</span> to unlock all 4 shards and Stage 6.
            </p>
            <input
              type="text"
              autoFocus
              value={codeValue}
              onChange={(e) => setCodeValue(e.target.value)}
              placeholder="Enter code..."
              className={`w-full px-4 py-3 rounded-xl bg-[#061020] border text-center font-mono text-base tracking-widest text-cyan-300 outline-none mb-5 ${
                codeError ? 'border-red-400' : 'border-white/20 focus:border-cyan-400'
              }`}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-xl bg-white/10 text-sm font-semibold hover:bg-white/15 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-cyan-400 text-slate-950 text-sm font-bold hover:bg-cyan-300 cursor-pointer"
              >
                Redeem
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Controls Modal */}
      {activeModal === 'controls' && (
        <div
          data-ui-interactive="true"
          onClick={closeModal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#040a14]/80"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#0a182d] border border-white/15 rounded-2xl p-6 text-slate-100 shadow-2xl"
          >
            <h2 className="font-display text-xl font-bold text-white mb-1">Movement & Controls</h2>
            <p className="text-sm text-slate-300 mb-4">
              Choose your keyboard preset. Movement stays aligned to your camera heading.
            </p>

            <div className="flex gap-2 p-1 rounded-xl bg-[#061020] border border-white/10 mb-5">
              <button
                type="button"
                onClick={() => handleLayoutChange('WASD')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  keyLayout === 'WASD' ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                QWERTY (WASD)
              </button>
              <button
                type="button"
                onClick={() => handleLayoutChange('ZQSD')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  keyLayout === 'ZQSD' ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                AZERTY (ZQSD)
              </button>
            </div>

            <div className="space-y-2 text-sm mb-5">
              <div className="flex justify-between py-2 px-3 rounded-lg bg-white/5">
                <span className="text-slate-300">Forward / Strafe</span>
                <span className="font-mono text-cyan-300 font-semibold">
                  {keyLayout === 'WASD' ? 'WASD / Arrows' : 'ZQSD / Arrows'}
                </span>
              </div>
              <div className="flex justify-between py-2 px-3 rounded-lg bg-white/5">
                <span className="text-slate-300">Jump (Variable) / Wind Glide</span>
                <span className="font-mono text-cyan-300 font-semibold">Space (Tap / Hold)</span>
              </div>
              <div className="flex justify-between py-2 px-3 rounded-lg bg-white/5">
                <span className="text-slate-300">Air Dash</span>
                <span className="font-mono text-cyan-300 font-semibold">Shift</span>
              </div>
              <div className="flex justify-between py-2 px-3 rounded-lg bg-white/5">
                <span className="text-slate-300">Ledge Mantle</span>
                <span className="font-mono text-cyan-300 font-semibold">Automatic at Rim</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-white/5 mb-5">
              <span className="text-sm text-slate-200">On-Screen Touch Pad</span>
              <button
                type="button"
                onClick={() => engineRef.current?.toggleTouchControls()}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-cyan-300 cursor-pointer"
              >
                {hud.touchVisible ? 'Visible' : 'Hidden'}
              </button>
            </div>

            <button
              type="button"
              onClick={closeModal}
              className="w-full py-2.5 rounded-xl bg-cyan-400 text-slate-950 text-sm font-bold hover:bg-cyan-300 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Pause & Settings Modal */}
      {activeModal === 'pause' && (
        <div
          data-ui-interactive="true"
          onClick={closeModal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#040a14]/82"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#0a182d] border border-white/15 rounded-2xl p-6 text-slate-100 shadow-2xl"
          >
            <div className="flex items-center gap-2.5 mb-1">
              <SlidersHorizontal className="w-5 h-5 text-cyan-300" />
              <h2 className="font-display text-xl font-bold text-white">Paused & Settings</h2>
            </div>
            <p className="text-sm text-slate-300 mb-5">
              Adjust audio, camera feel, or restart your run from Stage 1.
            </p>

            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-200">Skyway Background Music</span>
                <button
                  type="button"
                  onClick={() => handleSettingChange({ musicEnabled: !settings.musicEnabled })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    settings.musicEnabled ? 'bg-cyan-400 text-slate-950' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {settings.musicEnabled ? 'Enabled' : 'Muted'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-200">Wind & Sound Effects</span>
                <button
                  type="button"
                  onClick={() => handleSettingChange({ sfxEnabled: !settings.sfxEnabled })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    settings.sfxEnabled ? 'bg-cyan-400 text-slate-950' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {settings.sfxEnabled ? 'Enabled' : 'Muted'}
                </button>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                  <span>Mouse Sensitivity</span>
                  <span className="tabular-nums font-semibold text-cyan-300">{settings.sensitivity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={2.2}
                  step={0.1}
                  value={settings.sensitivity}
                  onChange={(e) => handleSettingChange({ sensitivity: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                  <span>Field of View (FOV)</span>
                  <span className="tabular-nums font-semibold text-cyan-300">{settings.baseFov}°</span>
                </div>
                <input
                  type="range"
                  min={55}
                  max={85}
                  step={1}
                  value={settings.baseFov}
                  onChange={(e) => handleSettingChange({ baseFov: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleResetRun}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/10 text-sm font-semibold hover:bg-white/15 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Restart Run</span>
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-xl bg-cyan-400 text-slate-950 text-sm font-bold hover:bg-cyan-300 cursor-pointer"
              >
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summit Victory Screen Modal */}
      {activeModal === 'victory' && victorySummary && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#040a14]/85"
        >
          <div className="w-full max-w-md bg-[#0a182d] border border-amber-400/50 rounded-2xl p-7 text-slate-100 shadow-2xl text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-400/15 text-amber-300 mb-3">
              <Trophy className="w-6 h-6" />
            </div>
            <h2 className="font-display text-2xl font-extrabold text-white mb-1">
              Celestial Spire Reached
            </h2>
            <p className="text-sm text-slate-300 mb-5">
              {victorySummary.ascendantUnlocked
                ? 'All 4 Echo Shards gathered — the Golden Astral Gate is open above the Spire.'
                : 'You conquered the skyway. Hunt all 4 Echo Shards to unlock Golden Seraph Wings and Stage 6.'}
            </p>

            <div className="grid grid-cols-2 gap-3 text-left mb-6">
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-slate-400 mb-0.5 flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Run Time</span>
                </div>
                <div className="font-display text-xl font-bold text-white tabular-nums">
                  {formatTime(victorySummary.elapsedMs)}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-slate-400 mb-0.5 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-300" />
                  <span>{victorySummary.isNewBest ? 'New Best!' : 'Best Time'}</span>
                </div>
                <div className="font-display text-xl font-bold text-amber-300 tabular-nums">
                  {formatTime(victorySummary.bestTimeMs)}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-slate-400 mb-0.5 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-rose-300" />
                  <span>Echo Shards</span>
                </div>
                <div className="font-display text-xl font-bold text-rose-300 tabular-nums">
                  {victorySummary.shardsCollected} / {victorySummary.totalShards}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-slate-400 mb-0.5 flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-sky-300" />
                  <span>Falls</span>
                </div>
                <div className="font-display text-xl font-bold text-slate-100 tabular-nums">
                  {victorySummary.falls}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 py-3 rounded-xl bg-white/10 text-sm font-semibold text-white hover:bg-white/15 cursor-pointer"
              >
                Keep Exploring
              </button>
              <button
                type="button"
                onClick={handleResetRun}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-400 text-slate-950 text-sm font-bold hover:bg-amber-300 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Play Again</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
