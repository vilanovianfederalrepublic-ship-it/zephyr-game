import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AudioDriver } from './audio';
import { ParticleSystem } from './particles';
import { PlayerRig } from './player';
import {
  EngineCallbacks,
  GameSettings,
  HudState,
  KeyBindMap,
  KeyLayout,
  VictorySummary,
} from './types';
import {
  buildWorld,
  CheckpointData,
  STAGE_ATMOSPHERES,
  WorldData,
} from './world';

const BEST_TIME_KEY = 'zephyr_best_time_ms_v2';
const PLAYER_RADIUS = 0.42;
const PLAYER_HEIGHT = 1.85;

// Pre-allocated math helpers (zero per-frame GC allocations)
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _skyTarget = new THREE.Color();
const _fogTarget = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function shortestAngleDiff(current: number, target: number): number {
  let diff = (target - current + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  return diff - Math.PI;
}

export class ZephyrEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: EngineCallbacks;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly isSoftwareGl: boolean;
  private readonly sun: THREE.DirectionalLight;
  private readonly audio: AudioDriver;
  private readonly particles: ParticleSystem;
  private readonly playerRig: PlayerRig;
  private readonly world: WorldData;

  private settings: GameSettings = {
    sensitivity: 1.0,
    baseFov: 65,
    musicEnabled: true,
    sfxEnabled: true,
  };

  private keyBinds: KeyBindMap = {
    forward: ['KeyW', 'ArrowUp'],
    backward: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['Space'],
    dash: ['ShiftLeft', 'ShiftRight'],
  };

  private readonly keys: Record<string, boolean> = {};
  private readonly virtualAxis = { x: 0, y: 0 };
  private touchJumpHeld = false;

  // Player kinematics
  private readonly player = {
    pos: new THREE.Vector3(0, 2.5, 0),
    vel: new THREE.Vector3(),
    speed: 14.5,
    jumpForce: 15.2,
    gravity: 34,
    isGrounded: false,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    wasJumpHeld: false,
    updraftBoosted: false,
    canAirDash: true,
    ascendantDashCooldown: 0,
    isDashing: false,
    dashTimer: 0,
    isGliding: false,
    wasGliding: false,
    activePlatform: null as WorldData['movingPlatforms'][number] | null,
    facingYaw: 0,
  };

  // Camera state
  private mouseYaw = 0;
  private mousePitch = 0.25;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private isFirstPerson = false;
  private fovKick = 0;
  private dashShake = 0;
  private readonly camPosCurrent = new THREE.Vector3(0, 5, 8);
  private readonly camLookCurrent = new THREE.Vector3(0, 2, 0);

  // Run & progression state
  private activeCheckpoint: CheckpointData;
  private highestStageIndex = 0;
  private collectedCount = 0;
  private ascendantUnlocked = false;
  private victoryTriggered = false;
  private hasStarted = false;
  private isPaused = false;
  private isModalBlocked = false;
  private touchVisible = false;
  private elapsedMs = 0;
  private falls = 0;
  private bestTimeMs: number | null = null;
  private hudEmitAccum = 0;

  // Loop & lifecycle
  private frameId = 0;
  private disposed = false;
  private lastFrameTime = performance.now();
  private readonly cleanupListeners: (() => void)[] = [];

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.bestTimeMs = this.loadBestTime();

    this.isSoftwareGl = detectSoftwareWebGL();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(STAGE_ATMOSPHERES[0].skyHex);
    this.scene.fog = new THREE.FogExp2(STAGE_ATMOSPHERES[0].fogHex, STAGE_ATMOSPHERES[0].fogDensity);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.settings.baseFov, width / height, 0.1, 1100);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      this.callbacks.onWebglError('WebGL is unsupported or disabled in this browser.');
      throw new Error('WebGL initialization failed');
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Studio environment reflection for metallic gold/trim/visor PBR
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Warm/Cool 2-light outdoor sky rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.8);
    this.scene.add(hemiLight);

    this.sun = new THREE.DirectionalLight(0xfff5e6, 1.15);
    this.sun.castShadow = !this.isSoftwareGl;
    this.sun.shadow.mapSize.width = 1024;
    this.sun.shadow.mapSize.height = 1024;
    const span = 64;
    this.sun.shadow.camera.left = -span;
    this.sun.shadow.camera.right = span;
    this.sun.shadow.camera.top = span;
    this.sun.shadow.camera.bottom = -span;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.audio = new AudioDriver();
    this.particles = new ParticleSystem(this.scene);
    this.playerRig = new PlayerRig(this.scene);
    this.world = buildWorld(this.scene);

    this.activeCheckpoint = this.world.checkpoints[0];
    this.world.setCheckpointActive(this.activeCheckpoint, true);
    this.playerRig.group.position.copy(this.player.pos);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.emitHud();
    this.startLoop();
  }

  private loadBestTime(): number | null {
    try {
      const raw = localStorage.getItem(BEST_TIME_KEY);
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  }

  private saveBestTime(ms: number): void {
    try {
      localStorage.setItem(BEST_TIME_KEY, String(Math.round(ms)));
    } catch {
      // Ignore storage quota errors
    }
  }

  private bindEvents(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.isModalBlocked) return;
      if (e.code === 'Escape') {
        if (this.hasStarted) {
          this.setPaused(!this.isPaused);
        }
        return;
      }
      if (this.isPaused) return;

      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }

      const wasDown = this.keys[e.code];
      this.keys[e.code] = true;

      if (!wasDown && this.keyBinds.jump.includes(e.code)) {
        this.player.jumpBufferTimer = 0.14;
      }
      if (!wasDown && this.keyBinds.dash.includes(e.code)) {
        this.triggerDash();
      }
      if (!wasDown && e.code === 'KeyR' && this.hasStarted) {
        this.respawn(true);
      }
      if (!wasDown && (e.code === 'KeyV' || e.code === 'KeyC') && this.hasStarted) {
        this.toggleCameraView();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };

    const onBlur = () => {
      for (const k of Object.keys(this.keys)) {
        this.keys[k] = false;
      }
      this.isDragging = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!this.hasStarted || this.isPaused || this.isModalBlocked) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('[data-ui-interactive="true"]') || target.closest('button'))) return;

      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (document.pointerLockElement !== this.renderer.domElement) {
        try {
          this.renderer.domElement.requestPointerLock?.();
        } catch {
          // Ignore pointer lock rejection
        }
      }
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.hasStarted || this.isPaused || this.isModalBlocked) return;
      const sens = this.settings.sensitivity;
      if (document.pointerLockElement === this.renderer.domElement) {
        this.mouseYaw -= e.movementX * 0.0024 * sens;
        this.mousePitch += e.movementY * 0.0024 * sens;
      } else if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.mouseYaw -= dx * 0.004 * sens;
        this.mousePitch += dy * 0.004 * sens;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }

      const minP = this.isFirstPerson ? -1.35 : -0.35;
      const maxP = this.isFirstPerson ? 1.35 : 1.22;
      this.mousePitch = Math.max(minP, Math.min(maxP, this.mousePitch));
    };

    // Only show touch controls when the user ACTUALLY touches the screen (prevents showing on touch laptops)
    const onFirstTouch = () => {
      if (!this.touchVisible && this.hasStarted) {
        this.touchVisible = true;
        this.emitHud();
      }
    };

    const onResize = () => {
      if (this.disposed) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onWebglError('WebGL rendering context was interrupted. Attempting recovery...');
    };

    const onContextRestored = () => {
      this.callbacks.onToast('Graphics context restored', 'info');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onFirstTouch, { passive: true });
    window.addEventListener('resize', onResize);
    this.renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    this.cleanupListeners.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onFirstTouch);
      window.removeEventListener('resize', onResize);
      this.renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    });
  }

  /* =========================================================================
     PUBLIC ENGINE CONTROLS (CALLED FROM REACT HUD & MODALS)
     ========================================================================= */
  public startGame(): void {
    this.hasStarted = true;
    this.isPaused = false;
    this.audio.unlock();
    this.audio.setPaused(false);
    try {
      this.renderer.domElement.requestPointerLock?.();
    } catch {
      // Ignore pointer lock rejection
    }
    this.emitHud();
  }

  public setPaused(paused: boolean): void {
    if (!this.hasStarted) return;
    this.isPaused = paused;
    this.audio.setPaused(paused);
    if (paused) {
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignore
      }
    } else if (!this.isModalBlocked) {
      try {
        this.renderer.domElement.requestPointerLock?.();
      } catch {
        // Ignore
      }
    }
    this.emitHud();
  }

  public setModalBlocked(blocked: boolean): void {
    this.isModalBlocked = blocked;
    if (blocked) {
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignore
      }
    } else if (this.hasStarted && !this.isPaused) {
      try {
        this.renderer.domElement.requestPointerLock?.();
      } catch {
        // Ignore
      }
    }
  }

  public setKeyLayout(layout: KeyLayout): void {
    if (layout === 'WASD') {
      this.keyBinds.forward = ['KeyW', 'ArrowUp'];
      this.keyBinds.backward = ['KeyS', 'ArrowDown'];
      this.keyBinds.left = ['KeyA', 'ArrowLeft'];
      this.keyBinds.right = ['KeyD', 'ArrowRight'];
      this.callbacks.onToast('Controls set to QWERTY (WASD)', 'info');
    } else {
      this.keyBinds.forward = ['KeyZ', 'ArrowUp'];
      this.keyBinds.backward = ['KeyS', 'ArrowDown'];
      this.keyBinds.left = ['KeyQ', 'ArrowLeft'];
      this.keyBinds.right = ['KeyD', 'ArrowRight'];
      this.callbacks.onToast('Controls set to AZERTY (ZQSD)', 'info');
    }
    this.audio.click();
  }

  public toggleCameraView(): void {
    this.isFirstPerson = !this.isFirstPerson;
    this.audio.click();
    this.playerRig.visuals.visible = !this.isFirstPerson;
    this.callbacks.onToast(this.isFirstPerson ? 'First Person View' : 'Third Person View', 'info');
    this.emitHud();
  }

  public updateSettings(next: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...next };
    this.audio.setMusicEnabled(this.settings.musicEnabled);
    this.audio.setSfxEnabled(this.settings.sfxEnabled);
  }

  public toggleTouchControls(): void {
    this.touchVisible = !this.touchVisible;
    this.audio.click();
    this.emitHud();
  }

  public setVirtualAxis(x: number, y: number): void {
    this.virtualAxis.x = x;
    this.virtualAxis.y = y;
  }

  public applyTouchLook(dx: number, dy: number): void {
    const sens = this.settings.sensitivity;
    this.mouseYaw -= dx * 0.006 * sens;
    this.mousePitch += dy * 0.006 * sens;
    const minP = this.isFirstPerson ? -1.35 : -0.35;
    const maxP = this.isFirstPerson ? 1.35 : 1.22;
    this.mousePitch = Math.max(minP, Math.min(maxP, this.mousePitch));
  }

  public setTouchJump(held: boolean): void {
    if (held && !this.touchJumpHeld) {
      this.player.jumpBufferTimer = 0.14;
    }
    this.touchJumpHeld = held;
  }

  public triggerDash(): void {
    if (!this.hasStarted || this.isPaused || this.isModalBlocked) return;
    const canDashNow =
      !this.player.isGrounded &&
      !this.player.isDashing &&
      (this.player.canAirDash || (this.ascendantUnlocked && this.player.ascendantDashCooldown <= 0));

    if (!canDashNow) return;

    this.player.canAirDash = false;
    this.player.ascendantDashCooldown = 0.28;
    this.player.isDashing = true;
    this.player.dashTimer = 0.19;
    this.player.isGliding = false;
    this.player.updraftBoosted = false;

    this.audio.dash();
    this.fovKick = 13;
    this.dashShake = 0.35;
    this.playerRig.triggerSquash(1.24);

    _vecA.set(-Math.sin(this.mouseYaw), 0, -Math.cos(this.mouseYaw)).normalize();
    this.player.vel.copy(_vecA).multiplyScalar(30);
    this.player.vel.y = 3.2;

    const burstColor = this.ascendantUnlocked ? 0xffd700 : 0x00ffd5;
    this.particles.emitBurst(this.player.pos, 18, burstColor, 10, 0.72, 0.38, 0.15, 2);
  }

  public redeemCode(rawCode: string): boolean {
    const code = rawCode.trim().toUpperCase();

    if (code === 'SECRET_CODE') {
      const targetCp = this.world.finalCheckpoint;
      this.warpToCheckpoint(targetCp);
      this.audio.warp();
      this.callbacks.onToast('Code Redeemed: Warped to Celestial Spire!', 'victory');
      return true;
    }

    if (code === 'ASCEND') {
      this.unlockAllShardsBonus();
      this.audio.grandFanfare();
      this.callbacks.onToast('Code Redeemed: Ascendant Wings & Stage 6 Unlocked!', 'victory');
      return true;
    }

    this.callbacks.onToast('Invalid Code — Try SECRET_CODE or ASCEND', 'warn');
    return false;
  }

  public resetFullRun(): void {
    this.world.checkpoints.forEach((cp) => this.world.setCheckpointActive(cp, false));
    this.activeCheckpoint = this.world.checkpoints[0];
    this.world.setCheckpointActive(this.activeCheckpoint, true);
    this.highestStageIndex = 0;

    this.world.resetShards();
    this.collectedCount = 0;
    this.ascendantUnlocked = false;
    this.world.ascendantBridgeGroup.visible = false;
    this.world.ascendantGateRing.group.visible = false;
    this.playerRig.setAscendant(false);

    this.victoryTriggered = false;
    this.elapsedMs = 0;
    this.falls = 0;
    this.isPaused = false;
    this.audio.setPaused(false);

    this.player.pos.set(0, 2.5, 0);
    this.player.vel.set(0, 0, 0);
    this.player.activePlatform = null;
    this.player.canAirDash = true;
    this.player.isDashing = false;
    this.player.isGliding = false;
    this.mouseYaw = 0;
    this.mousePitch = 0.25;
    this.playerRig.group.position.copy(this.player.pos);

    this.audio.warp();
    this.callbacks.onToast('Run Reset — Good luck!', 'info');
    this.emitHud();
  }

  private warpToCheckpoint(cp: CheckpointData): void {
    this.world.checkpoints.forEach((c) => this.world.setCheckpointActive(c, false));
    this.world.setCheckpointActive(cp, true);
    this.activeCheckpoint = cp;
    this.highestStageIndex = Math.max(this.highestStageIndex, cp.stageIndex);

    this.player.pos.copy(cp.position);
    this.player.vel.set(0, 0, 0);
    this.player.activePlatform = null;
    this.player.canAirDash = true;
    this.player.isDashing = false;
    this.player.isGliding = false;
    this.playerRig.group.position.copy(this.player.pos);
    this.emitHud();
  }

  private unlockAllShardsBonus(): void {
    this.world.shards.forEach((sh) => {
      sh.collected = true;
      sh.group.visible = false;
    });
    this.collectedCount = this.world.shards.length;
    this.activateAscendantMode();
  }

  private activateAscendantMode(): void {
    if (this.ascendantUnlocked) return;
    this.ascendantUnlocked = true;
    this.playerRig.setAscendant(true);
    this.world.ascendantBridgeGroup.visible = true;
    this.world.ascendantGateRing.group.visible = true;
    this.particles.emitBurst(this.player.pos, 26, 0xffd700, 12, 0.85, 0.7, 0.6, 5);
  }

  private respawn(manual = false): void {
    this.audio.fall();
    if (!manual) {
      this.falls += 1;
    }
    this.player.pos.copy(this.activeCheckpoint.position);
    this.player.vel.set(0, 0, 0);
    this.player.activePlatform = null;
    this.player.canAirDash = true;
    this.player.isDashing = false;
    this.player.isGliding = false;
    this.playerRig.group.position.copy(this.player.pos);
    this.particles.emitBurst(this.player.pos, 14, 0x38bdf8, 6, 0.55, 0.4, 0.5, 4);
    this.emitHud();
  }

  /* =========================================================================
     PHYSICS, COLLISION & RENDER LOOP
     ========================================================================= */
  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
      this.lastFrameTime = now;

      this.update(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private update(dt: number): void {
    // Rotate decorative clockwork gears & shards even on title screen
    const timeSec = performance.now() * 0.001;
    this.world.gearRings.forEach((gear, i) => {
      gear.rotation.z += dt * (i % 2 === 0 ? 0.65 : -0.65);
    });

    this.world.shards.forEach((sh) => {
      if (!sh.collected) {
        sh.core.rotation.y += dt * 2.4;
        sh.core.rotation.x += dt * 1.1;
        sh.ring.rotation.z -= dt * 1.8;
        sh.group.position.y = sh.pos.y + Math.sin(timeSec * 2.6 + sh.id) * 0.25;
      }
    });

    // Animate updraft columns + cooldowns
    this.world.updraftRings.forEach((up) => {
      if (up.ascendantOnly && !this.ascendantUnlocked) return;
      if (up.cooldown > 0) up.cooldown = Math.max(0, up.cooldown - dt);
      up.mesh.rotation.z += dt * 1.6;
      up.rings.forEach((r, idx) => {
        const cycle = ((timeSec * 1.3 + idx * 0.33) % 1);
        r.position.y = cycle * 6.5;
        const s = 1 - cycle * 0.35;
        r.scale.set(s, s, 1);
      });
      if (this.hasStarted && !this.isPaused && this.player.pos.distanceTo(up.pos) < 30 && Math.random() < dt * 8) {
        this.particles.emitUpdraftMote(up.pos, up.ascendantOnly ? 0xffd700 : 0xffe066);
      }
    });

    // Smoothly shift sky & fog atmosphere by stage
    const atmo = STAGE_ATMOSPHERES[Math.min(STAGE_ATMOSPHERES.length - 1, this.highestStageIndex)];
    _skyTarget.setHex(atmo.skyHex);
    _fogTarget.setHex(atmo.fogHex);
    const skyBlend = 1 - Math.exp(-1.5 * dt);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(_skyTarget, skyBlend);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.lerp(_fogTarget, skyBlend);
      this.scene.fog.density += (atmo.fogDensity - this.scene.fog.density) * skyBlend;
    }

    // Update Moving Platforms (capture prevMaxY BEFORE moving for swept anti-tunneling!)
    this.world.movingPlatforms.forEach((p) => {
      p.prevMaxY = p.collider.max.y;
      p.progress += dt * p.speed;
      const t = (Math.sin(p.progress) + 1) / 2;
      _vecA.copy(p.mesh.position);
      p.mesh.position.lerpVectors(p.start, p.end, t);
      p.delta.subVectors(p.mesh.position, _vecA);

      const hx = p.size.x / 2;
      const hy = p.size.y / 2;
      const hz = p.size.z / 2;
      p.collider.min.set(p.mesh.position.x - hx, p.mesh.position.y - hy, p.mesh.position.z - hz);
      p.collider.max.set(p.mesh.position.x + hx, p.mesh.position.y + hy, p.mesh.position.z + hz);
    });

    this.particles.update(dt);

    if (!this.hasStarted || this.isPaused) {
      this.updateIdleCamera(dt, timeSec);
      return;
    }

    if (!this.victoryTriggered) {
      this.elapsedMs += dt * 1000;
    }

    // Update directional follow-sun
    this.sun.position.set(this.player.pos.x + 48, this.player.pos.y + 78, this.player.pos.z + 38);
    this.sun.target.position.copy(this.player.pos);

    // 1. Input Intent (Camera-aligned true heading)
    let forwardInput = 0;
    let strafeInput = 0;

    if (!this.isModalBlocked) {
      if (this.keyBinds.forward.some((k) => this.keys[k])) forwardInput += 1;
      if (this.keyBinds.backward.some((k) => this.keys[k])) forwardInput -= 1;
      if (this.keyBinds.right.some((k) => this.keys[k])) strafeInput += 1;
      if (this.keyBinds.left.some((k) => this.keys[k])) strafeInput -= 1;

      if (Math.hypot(this.virtualAxis.x, this.virtualAxis.y) > 0.1) {
        strafeInput += this.virtualAxis.x;
        forwardInput -= this.virtualAxis.y;
      }
    }

    const inputLen = Math.hypot(forwardInput, strafeInput);
    if (inputLen > 1) {
      forwardInput /= inputLen;
      strafeInput /= inputLen;
    }

    _vecB.set(0, 0, 0);
    if (inputLen > 0.05) {
      _vecB.x = forwardInput * -Math.sin(this.mouseYaw) + strafeInput * Math.cos(this.mouseYaw);
      _vecB.z = forwardInput * -Math.cos(this.mouseYaw) + strafeInput * -Math.sin(this.mouseYaw);
    }

    // 2. Jump Buffer, Variable Jump Height, Wind Glide & Air Dash
    const jumpHeld =
      !this.isModalBlocked &&
      (this.keyBinds.jump.some((k) => this.keys[k]) || this.touchJumpHeld);

    if (this.player.jumpBufferTimer > 0) {
      this.player.jumpBufferTimer = Math.max(0, this.player.jumpBufferTimer - dt);
    }
    if (this.player.ascendantDashCooldown > 0) {
      this.player.ascendantDashCooldown = Math.max(0, this.player.ascendantDashCooldown - dt);
    }

    if (this.player.isGrounded) {
      this.player.coyoteTimer = 0.14;
      this.player.canAirDash = true;
      this.player.isGliding = false;
      this.player.updraftBoosted = false;
    } else {
      this.player.coyoteTimer = Math.max(0, this.player.coyoteTimer - dt);
    }

    // Execute buffered jump if within coyote window
    if (this.player.jumpBufferTimer > 0 && this.player.coyoteTimer > 0) {
      this.audio.jump();
      this.player.vel.y = this.player.jumpForce;
      this.player.coyoteTimer = 0;
      this.player.jumpBufferTimer = 0;
      this.player.isGrounded = false;
      this.player.updraftBoosted = false;
      this.playerRig.triggerSquash(1.26);

      if (this.player.activePlatform) {
        _vecA.copy(this.player.activePlatform.delta).divideScalar(Math.max(dt, 0.001));
        this.player.vel.x += _vecA.x * 0.75;
        this.player.vel.z += _vecA.z * 0.75;
        this.player.vel.y += Math.max(0, _vecA.y * 0.5);
        this.player.activePlatform = null;
      }
    }

    // Variable jump height: releasing jump early cuts ascent
    if (!jumpHeld && this.player.wasJumpHeld && this.player.vel.y > 4.5 && !this.player.updraftBoosted && !this.player.isDashing) {
      this.player.vel.y *= 0.52;
    }
    this.player.wasJumpHeld = jumpHeld;

    // Wind Glide: holding Jump while descending deploys wings
    this.player.wasGliding = this.player.isGliding;
    if (!this.player.isGrounded && !this.player.isDashing && jumpHeld && this.player.vel.y < -1.4) {
      this.player.isGliding = true;
      if (!this.player.wasGliding) {
        this.audio.glideDeploy();
      }
    } else {
      this.player.isGliding = false;
    }

    // Horizontal acceleration & frame-rate-independent exponential damping
    if (this.player.isDashing) {
      this.player.dashTimer -= dt;
      _vecA.set(this.player.vel.x, 0, this.player.vel.z).normalize();
      this.particles.emitDashTrail(
        this.player.pos,
        _vecA,
        this.ascendantUnlocked ? 0xffd700 : 0x00ffd5,
      );
      if (this.player.dashTimer <= 0) {
        this.player.isDashing = false;
      }
    } else {
      const topSpeed = this.player.isGliding ? this.player.speed * (this.ascendantUnlocked ? 1.28 : 1.1) : this.player.speed;
      const tx = _vecB.x * topSpeed;
      const tz = _vecB.z * topSpeed;
      const lambda = this.player.isGrounded ? 18 : this.player.isGliding ? 9.5 : 6.5;
      const blend = 1 - Math.exp(-lambda * dt);
      this.player.vel.x += (tx - this.player.vel.x) * blend;
      this.player.vel.z += (tz - this.player.vel.z) * blend;

      this.player.vel.y -= this.player.gravity * dt;
      if (this.player.isGliding) {
        const maxFall = this.ascendantUnlocked ? -2.8 : -4.2;
        if (this.player.vel.y < maxFall) {
          this.player.vel.y += (maxFall - this.player.vel.y) * (1 - Math.exp(-14 * dt));
        }
      }
    }

    // Carry player with active moving platform before integration
    if (this.player.activePlatform) {
      this.player.pos.add(this.player.activePlatform.delta);
    }

    const prevY = this.player.pos.y;
    const prevTop = prevY + PLAYER_HEIGHT;

    this.player.pos.x += this.player.vel.x * dt;
    this.player.pos.y += this.player.vel.y * dt;
    this.player.pos.z += this.player.vel.z * dt;

    // 3. Full 3D Collision Resolution (Swept Moving Platforms, Top, Bottom & Sides + Ledge Mantle)
    const wasGrounded = this.player.isGrounded;
    const impactSpeed = -this.player.vel.y;
    let groundY = -Infinity;
    let newActivePlatform: WorldData['movingPlatforms'][number] | null = null;

    // 3a. Swept Vertical Checks (Static + Moving Platforms)
    for (let i = 0; i < this.world.colliders.length; i++) {
      const col = this.world.colliders[i];
      const b = col.box;
      if (
        this.player.pos.x >= b.min.x - PLAYER_RADIUS * 0.7 &&
        this.player.pos.x <= b.max.x + PLAYER_RADIUS * 0.7 &&
        this.player.pos.z >= b.min.z - PLAYER_RADIUS * 0.7 &&
        this.player.pos.z <= b.max.z + PLAYER_RADIUS * 0.7
      ) {
        // Floor check
        if (col.isClimbableTop && prevY >= b.max.y - 0.3 && this.player.pos.y <= b.max.y + 0.42 && this.player.vel.y <= 0.5) {
          if (b.max.y > groundY) groundY = b.max.y;
        }
        // Underside / Ceiling check
        if (prevTop <= b.min.y + 0.28 && this.player.pos.y + PLAYER_HEIGHT >= b.min.y && this.player.vel.y > 0) {
          this.player.pos.y = b.min.y - PLAYER_HEIGHT - 0.01;
          this.player.vel.y = 0;
        }
      }
    }

    for (let i = 0; i < this.world.movingPlatforms.length; i++) {
      const p = this.world.movingPlatforms[i];
      const b = p.collider;
      const platVelY = p.delta.y / Math.max(dt, 0.001);
      if (
        this.player.pos.x >= b.min.x - PLAYER_RADIUS * 0.75 &&
        this.player.pos.x <= b.max.x + PLAYER_RADIUS * 0.75 &&
        this.player.pos.z >= b.min.z - PLAYER_RADIUS * 0.75 &&
        this.player.pos.z <= b.max.z + PLAYER_RADIUS * 0.75
      ) {
        // Swept rising-platform check prevents tunneling on vertical elevators
        const sweptAbovePrev = prevY >= p.prevMaxY - 0.35;
        const sweptAboveCurr = prevY >= b.max.y - 0.35;
        if ((sweptAbovePrev || sweptAboveCurr) && this.player.pos.y <= b.max.y + 0.45 && this.player.vel.y <= platVelY + 2.0) {
          if (b.max.y > groundY) {
            groundY = b.max.y;
            newActivePlatform = p;
          }
        }
        // Underside check on downward-moving platforms
        if (prevTop <= b.min.y + 0.3 && this.player.pos.y + PLAYER_HEIGHT >= b.min.y && this.player.vel.y > platVelY) {
          this.player.pos.y = b.min.y - PLAYER_HEIGHT - 0.01;
          this.player.vel.y = Math.min(0, platVelY);
        }
      }
    }

    if (groundY !== -Infinity) {
      this.player.pos.y = groundY;
      this.player.vel.y = 0;
      this.player.isGrounded = true;
      this.player.activePlatform = newActivePlatform;
      if (!wasGrounded && impactSpeed > 4.5) {
        this.audio.land(impactSpeed);
        this.playerRig.triggerSquash(Math.max(0.68, 1 - impactSpeed * 0.012));
        this.particles.emitLandingRing(this.player.pos);
      }
    } else {
      this.player.isGrounded = false;
      this.player.activePlatform = null;
    }

    // 3b. Horizontal Side-Wall Pushout + Ledge Forgiveness Mantle
    const resolveSideAndMantle = (b: THREE.Box3, isClimbableTop: boolean, platformRef: WorldData['movingPlatforms'][number] | null) => {
      if (this.player.pos.y + PLAYER_HEIGHT - 0.15 <= b.min.y || this.player.pos.y + 0.12 >= b.max.y) {
        return;
      }
      const closestX = Math.max(b.min.x, Math.min(this.player.pos.x, b.max.x));
      const closestZ = Math.max(b.min.z, Math.min(this.player.pos.z, b.max.z));
      const dx = this.player.pos.x - closestX;
      const dz = this.player.pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq >= PLAYER_RADIUS * PLAYER_RADIUS) return;

      // Ledge Forgiveness: if hitting near the top edge of an island while falling/moving, auto-mantle!
      const ledgeDiff = b.max.y - this.player.pos.y;
      if (isClimbableTop && ledgeDiff > 0.05 && ledgeDiff <= 0.85 && this.player.vel.y <= 5.5) {
        this.player.pos.y = b.max.y + 0.02;
        this.player.vel.y = 0;
        this.player.isGrounded = true;
        this.player.activePlatform = platformRef;
        this.playerRig.triggerSquash(0.84);
        this.audio.mantle();
        this.particles.emitBurst(this.player.pos, 6, 0xe0f2fe, 4.5, 0.42, 0.28, 0.4, 6);
        return;
      }

      // Solid Side Wall Pushout
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const pen = PLAYER_RADIUS - dist;
        this.player.pos.x += nx * pen;
        this.player.pos.z += nz * pen;
        const vn = this.player.vel.x * nx + this.player.vel.z * nz;
        if (vn < 0) {
          this.player.vel.x -= nx * vn;
          this.player.vel.z -= nz * vn;
        }
      } else {
        // Inside AABB fallback: push along shallowest XZ face
        const penLeft = Math.abs(this.player.pos.x - b.min.x);
        const penRight = Math.abs(b.max.x - this.player.pos.x);
        const penBack = Math.abs(this.player.pos.z - b.min.z);
        const penFront = Math.abs(b.max.z - this.player.pos.z);
        const m = Math.min(penLeft, penRight, penBack, penFront);
        if (m === penLeft) this.player.pos.x = b.min.x - PLAYER_RADIUS;
        else if (m === penRight) this.player.pos.x = b.max.x + PLAYER_RADIUS;
        else if (m === penBack) this.player.pos.z = b.min.z - PLAYER_RADIUS;
        else this.player.pos.z = b.max.z + PLAYER_RADIUS;
      }
    };

    for (let i = 0; i < this.world.colliders.length; i++) {
      const c = this.world.colliders[i];
      resolveSideAndMantle(c.box, c.isClimbableTop, null);
    }
    for (let i = 0; i < this.world.movingPlatforms.length; i++) {
      const p = this.world.movingPlatforms[i];
      resolveSideAndMantle(p.collider, true, p);
    }

    // 4. Projected Drop Shadow
    let shadowY = -Infinity;
    for (let i = 0; i < this.world.colliders.length; i++) {
      const b = this.world.colliders[i].box;
      if (this.player.pos.x >= b.min.x && this.player.pos.x <= b.max.x && this.player.pos.z >= b.min.z && this.player.pos.z <= b.max.z) {
        if (b.max.y <= this.player.pos.y + 0.5 && b.max.y > shadowY) shadowY = b.max.y;
      }
    }
    for (let i = 0; i < this.world.movingPlatforms.length; i++) {
      const b = this.world.movingPlatforms[i].collider;
      if (this.player.pos.x >= b.min.x && this.player.pos.x <= b.max.x && this.player.pos.z >= b.min.z && this.player.pos.z <= b.max.z) {
        if (b.max.y <= this.player.pos.y + 0.5 && b.max.y > shadowY) shadowY = b.max.y;
      }
    }

    if (shadowY !== -Infinity && this.player.pos.y - shadowY < 26) {
      this.playerRig.dropShadow.visible = true;
      this.playerRig.dropShadow.position.set(this.player.pos.x, shadowY + 0.03, this.player.pos.z);
      const dist = Math.max(0, this.player.pos.y - shadowY);
      const s = Math.max(0.28, 1.0 - dist * 0.034);
      this.playerRig.dropShadow.scale.set(s, s, 1);
    } else {
      this.playerRig.dropShadow.visible = false;
    }

    // 5. Smooth Character Facing & Rig Animation
    let turnDelta = 0;
    if (_vecB.lengthSq() > 0.01) {
      const targetYaw = Math.atan2(_vecB.x, _vecB.z) + Math.PI;
      const diff = shortestAngleDiff(this.player.facingYaw, targetYaw);
      turnDelta = diff;
      this.player.facingYaw += diff * (1 - Math.exp(-15 * dt));
      this.playerRig.group.rotation.y = this.player.facingYaw;
    }
    this.playerRig.group.position.copy(this.player.pos);

    const horizSpeed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.playerRig.update(
      dt,
      horizSpeed,
      this.player.vel.y,
      this.player.isGrounded,
      this.player.isDashing,
      this.player.canAirDash || (this.ascendantUnlocked && this.player.ascendantDashCooldown <= 0),
      this.player.isGliding,
      turnDelta,
    );

    // Procedural Wind Audio scales smoothly with speed & altitude
    this.audio.updateWind(horizSpeed, this.player.vel.y, this.player.pos.y, this.highestStageIndex);

    // 6. Checkpoints (Monotonic — never demotes progress when walking backward!)
    this.world.checkpoints.forEach((cp) => {
      if (cp.stageIndex === 5 && !this.ascendantUnlocked) return;
      if (this.player.pos.distanceTo(cp.position) < 4.8 && !cp.active) {
        if (cp.stageIndex > this.highestStageIndex) {
          this.world.checkpoints.forEach((c) => this.world.setCheckpointActive(c, false));
          this.world.setCheckpointActive(cp, true);
          this.activeCheckpoint = cp;
          this.highestStageIndex = cp.stageIndex;
          this.audio.checkpoint();
          this.particles.emitBurst(cp.position, 20, 0x00ffd5, 9, 0.7, 0.55, 0.7, 6);
          this.callbacks.onToast(`Checkpoint: ${cp.name}`, 'info');

          if (cp === this.world.finalCheckpoint && !this.victoryTriggered) {
            this.triggerVictory();
          } else if (cp === this.world.crownCheckpoint) {
            this.audio.grandFanfare();
            this.callbacks.onToast('Astral Crown Conquered! True Sky Sovereign!', 'victory');
          }
          this.emitHud();
        }
      }
    });

    // 7. Echo Shards Collection & 4/4 Ascendant Reward
    this.world.shards.forEach((sh) => {
      if (!sh.collected && this.player.pos.distanceTo(sh.pos) < 3.2) {
        sh.collected = true;
        sh.group.visible = false;
        this.collectedCount += 1;
        this.particles.emitBurst(sh.pos, 24, 0xf43f5e, 10, 0.75, 0.6, 0.5, 5);

        if (this.collectedCount >= this.world.shards.length) {
          this.activateAscendantMode();
          this.audio.grandFanfare();
          this.callbacks.onToast('4/4 Echo Shards! Golden Wings, Infinite Dash & Astral Gate Unlocked!', 'victory');
        } else {
          this.audio.shard();
          this.callbacks.onToast(`[${this.collectedCount}/4] ${sh.name} Collected!`, 'shard');
        }
        this.emitHud();
      }
    });

    // 8. Updraft Rings (Cooldown prevents frame-by-frame audio/physics buzz!)
    this.world.updraftRings.forEach((up) => {
      if (up.ascendantOnly && !this.ascendantUnlocked) return;
      if (up.cooldown <= 0 && this.player.pos.distanceTo(up.pos) < 3.5) {
        up.cooldown = 0.42;
        this.player.vel.y = up.boost;
        this.player.canAirDash = true;
        this.player.isDashing = false;
        this.player.isGliding = false;
        this.player.updraftBoosted = true;
        this.audio.updraft();
        this.fovKick = Math.max(this.fovKick, 8);
        this.particles.emitBurst(up.pos, 16, up.ascendantOnly ? 0xffd700 : 0xffe066, 9, 0.65, 0.45, 0.9, -2);
      }
    });

    // 9. Stage-Relative Void Respawn Boundary
    const abyssY = Math.min(-28, this.activeCheckpoint.position.y - 26);
    if (this.player.pos.y < abyssY) {
      this.respawn(false);
    }

    // 10. Frame-Rate-Independent Camera Tracking + FOV Kick + Dash Shake
    this.fovKick += (0 - this.fovKick) * (1 - Math.exp(-7.5 * dt));
    this.dashShake = Math.max(0, this.dashShake - dt * 1.8);

    const speedFov = Math.min(8, Math.max(0, (horizSpeed - 12) * 0.45));
    const targetFov = this.settings.baseFov + this.fovKick + speedFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-12 * dt));
      this.camera.updateProjectionMatrix();
    }

    if (this.isFirstPerson) {
      const eyeY = this.player.pos.y + 1.62;
      this.camera.position.set(this.player.pos.x, eyeY, this.player.pos.z);
      _vecC.set(
        this.player.pos.x - Math.sin(this.mouseYaw) * Math.cos(this.mousePitch) * 20,
        eyeY - Math.sin(this.mousePitch) * 20,
        this.player.pos.z - Math.cos(this.mouseYaw) * Math.cos(this.mousePitch) * 20,
      );
      this.camera.lookAt(_vecC);
    } else {
      const camDist = 7.6;
      const shakeX = this.dashShake > 0 ? (Math.random() - 0.5) * this.dashShake * 0.45 : 0;
      const shakeY = this.dashShake > 0 ? (Math.random() - 0.5) * this.dashShake * 0.45 : 0;

      _vecA.set(
        this.player.pos.x + camDist * Math.sin(this.mouseYaw) * Math.cos(this.mousePitch) + shakeX,
        this.player.pos.y + 2.1 + camDist * Math.sin(this.mousePitch) + shakeY,
        this.player.pos.z + camDist * Math.cos(this.mouseYaw) * Math.cos(this.mousePitch),
      );
      const camBlend = 1 - Math.exp(-14 * dt);
      this.camPosCurrent.lerp(_vecA, camBlend);
      this.camera.position.copy(this.camPosCurrent);

      _vecC.set(this.player.pos.x, this.player.pos.y + 1.45, this.player.pos.z);
      this.camLookCurrent.lerp(_vecC, 1 - Math.exp(-18 * dt));
      this.camera.lookAt(this.camLookCurrent);
    }

    // Throttle React HUD updates (~15Hz) so DOM stays crisp without overhead
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.065) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private updateIdleCamera(dt: number, timeSec: number): void {
    const orbitYaw = timeSec * 0.14;
    const dist = 16;
    _vecA.set(
      this.player.pos.x + Math.sin(orbitYaw) * dist,
      this.player.pos.y + 7.5,
      this.player.pos.z + Math.cos(orbitYaw) * dist,
    );
    const blend = 1 - Math.exp(-4 * dt);
    this.camPosCurrent.lerp(_vecA, blend);
    this.camera.position.copy(this.camPosCurrent);
    this.camera.lookAt(this.player.pos.x, this.player.pos.y + 2.5, this.player.pos.z - 8);
  }

  private triggerVictory(): void {
    this.victoryTriggered = true;
    this.audio.victory();
    try {
      document.exitPointerLock?.();
    } catch {
      // Ignore
    }

    const isNewBest = this.bestTimeMs === null || this.elapsedMs < this.bestTimeMs;
    if (isNewBest) {
      this.bestTimeMs = this.elapsedMs;
      this.saveBestTime(this.elapsedMs);
    }

    const summary: VictorySummary = {
      elapsedMs: this.elapsedMs,
      bestTimeMs: this.bestTimeMs ?? this.elapsedMs,
      isNewBest,
      falls: this.falls,
      shardsCollected: this.collectedCount,
      totalShards: this.world.shards.length,
      ascendantUnlocked: this.ascendantUnlocked,
    };
    this.callbacks.onVictory(summary);
  }

  private emitHud(): void {
    const state: HudState = {
      stageName: this.activeCheckpoint.name,
      stageIndex: this.highestStageIndex,
      shardsCollected: this.collectedCount,
      totalShards: this.world.shards.length,
      elapsedMs: this.elapsedMs,
      falls: this.falls,
      speed: Math.hypot(this.player.vel.x, this.player.vel.z),
      canAirDash: this.player.canAirDash || this.ascendantUnlocked,
      isGliding: this.player.isGliding,
      ascendantUnlocked: this.ascendantUnlocked,
      isFirstPerson: this.isFirstPerson,
      isPaused: this.isPaused,
      hasStarted: this.hasStarted,
      touchVisible: this.touchVisible,
      victoryTriggered: this.victoryTriggered,
      bestTimeMs: this.bestTimeMs,
    };
    this.callbacks.onHudUpdate(state);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupListeners.forEach((fn) => fn());
    this.audio.dispose();
    this.particles.dispose();
    this.playerRig.dispose();
    this.world.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
