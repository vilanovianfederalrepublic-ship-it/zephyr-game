export class AudioDriver {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  // Procedural wind nodes
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  // Background music scheduler
  private musicTimerId: number | null = null;
  private nextNoteTime = 0;
  private stepIndex = 0;
  private currentStageFactor = 0;

  private musicEnabled = true;
  private sfxEnabled = true;
  private isPaused = false;
  private unlocked = false;

  // Dreamy Lydian skyway chord progression (MIDI notes)
  private readonly chords = [
    [48, 55, 60, 64, 67, 71], // Cmaj9
    [47, 55, 59, 62, 67, 74], // Gmaj7/B
    [45, 52, 57, 60, 64, 71], // Am9
    [41, 48, 53, 57, 60, 64], // Fmaj9
  ];
  private readonly arpPattern = [2, 4, 3, 5, 4, 2, 3, 5];

  public unlock(): void {
    if (!this.ctx) {
      const AudioClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioClass) return;
      this.ctx = new AudioClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicEnabled ? 0.34 : 0;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxEnabled ? 0.9 : 0;
      this.sfxGain.connect(this.masterGain);

      this.initWindGenerator();
      this.startMusicLoop();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (this.musicGain && this.ctx) {
      const target = enabled ? (this.isPaused ? 0.14 : 0.34) : 0;
      this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
    }
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(enabled ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (!this.ctx) return;
    if (this.musicGain) {
      const target = this.musicEnabled ? (paused ? 0.14 : 0.34) : 0;
      this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
    }
    if (paused && this.windGain) {
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
  }

  public updateWind(speed: number, verticalSpeed: number, altitude: number, stageIndex: number): void {
    this.currentStageFactor = Math.min(1, stageIndex / 5);
    if (!this.ctx || !this.windGain || !this.windFilter || !this.unlocked || this.isPaused) return;

    if (!this.sfxEnabled) {
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      return;
    }

    const totalSpeed = Math.hypot(speed, verticalSpeed * 0.75);
    const speedNorm = Math.min(1, totalSpeed / 30);
    const altNorm = Math.min(1, Math.max(0, altitude / 65));

    const targetGain = 0.015 + speedNorm * 0.17 + altNorm * 0.03;
    const targetFreq = 260 + speedNorm * 1450 + altNorm * 220;
    const targetQ = 1.2 + speedNorm * 1.4;

    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(targetGain, now, 0.06);
    this.windFilter.frequency.setTargetAtTime(targetFreq, now, 0.06);
    this.windFilter.Q.setTargetAtTime(targetQ, now, 0.08);
  }

  private initWindGenerator(): void {
    if (!this.ctx || !this.sfxGain) return;
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 3;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Pink-ish filtered noise for natural rushing wind
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.14;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 340;
    filter.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    source.start();

    this.windSource = source;
    this.windFilter = filter;
    this.windGain = gain;
  }

  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private startMusicLoop(): void {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;

    this.musicTimerId = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || !this.musicEnabled) return;
      if (this.ctx.state !== 'running') return;

      const lookahead = 0.25;
      const stepDuration = 0.34; // ~88 BPM eighth-note pulse

      while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
        this.scheduleMusicStep(this.stepIndex, this.nextNoteTime, stepDuration);
        this.nextNoteTime += stepDuration;
        this.stepIndex = (this.stepIndex + 1) % 32;
      }
    }, 100);
  }

  private scheduleMusicStep(step: number, time: number, stepDuration: number): void {
    if (!this.ctx || !this.musicGain) return;
    const chordIdx = Math.floor(step / 8) % this.chords.length;
    const chord = this.chords[chordIdx];

    // Warm pad chord at start of every 8-step bar
    if (step % 8 === 0) {
      const barDur = stepDuration * 7.8;
      [0, 2, 3, 4].forEach((idx, voiceIdx) => {
        if (!this.ctx || !this.musicGain) return;
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        osc.type = voiceIdx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(this.midiToFreq(chord[idx]), time);
        osc.detune.setValueAtTime((voiceIdx - 1.5) * 4, time);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900 + this.currentStageFactor * 700, time);

        env.gain.setValueAtTime(0.0001, time);
        env.gain.linearRampToValueAtTime(voiceIdx === 0 ? 0.18 : 0.08, time + 0.45);
        env.gain.exponentialRampToValueAtTime(0.001, time + barDur);

        osc.connect(filter);
        filter.connect(env);
        env.connect(this.musicGain);
        osc.start(time);
        osc.stop(time + barDur + 0.05);
      });
    }

    // Gentle sky arpeggio on alternating eighth steps
    const arpIdx = this.arpPattern[step % this.arpPattern.length];
    const arpMidi = chord[arpIdx] + (this.currentStageFactor > 0.55 && step % 4 === 2 ? 12 : 0);
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.midiToFreq(arpMidi), time);

    const noteGain = step % 2 === 0 ? 0.085 : 0.045;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(noteGain, time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0008, time + stepDuration * 1.6);

    osc.connect(env);
    env.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + stepDuration * 1.7);
  }

  private playTone(
    freqStart: number,
    freqEnd: number | null,
    type: OscillatorType,
    duration: number,
    gainVal = 0.2,
    delaySec = 0,
  ): void {
    if (!this.ctx || !this.sfxGain || !this.sfxEnabled) return;
    try {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      const start = this.ctx.currentTime + delaySec;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, start);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration);
      }

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(gainVal, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch {
      // Ignore transient Web Audio errors
    }
  }

  public jump(): void {
    this.playTone(230, 580, 'triangle', 0.16, 0.22);
  }

  public land(impactSpeed: number): void {
    const intensity = Math.min(1, Math.max(0.2, impactSpeed / 26));
    this.playTone(130, 48, 'sine', 0.11, 0.16 * intensity);
  }

  public dash(): void {
    this.playTone(360, 960, 'sawtooth', 0.14, 0.14);
    this.playTone(540, 1180, 'sine', 0.22, 0.22);
  }

  public glideDeploy(): void {
    this.playTone(320, 520, 'sine', 0.14, 0.11);
  }

  public mantle(): void {
    this.playTone(290, 460, 'triangle', 0.1, 0.14);
  }

  public updraft(): void {
    this.playTone(340, 880, 'sine', 0.28, 0.2);
    this.playTone(510, 1240, 'triangle', 0.22, 0.12, 0.04);
  }

  public fall(): void {
    this.playTone(220, 55, 'sawtooth', 0.34, 0.18);
  }

  public click(): void {
    this.playTone(620, 420, 'triangle', 0.07, 0.13);
  }

  public checkpoint(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.playTone(f, null, 'sine', 0.26, 0.14, i * 0.07);
    });
  }

  public shard(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
      this.playTone(f, null, 'triangle', 0.34, 0.17, i * 0.065);
    });
  }

  public grandFanfare(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0].forEach((f, i) => {
      this.playTone(f, null, 'sine', 0.55, 0.2, i * 0.075);
    });
  }

  public victory(): void {
    [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5, 1318.51, 1567.98].forEach((f, i) => {
      this.playTone(f, null, 'triangle', 0.45, 0.19, i * 0.09);
    });
  }

  public warp(): void {
    [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.playTone(f, f * 1.45, 'sine', 0.24, 0.18, i * 0.055);
    });
  }

  public dispose(): void {
    if (this.musicTimerId !== null) {
      clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }
    try {
      this.windSource?.stop();
    } catch {
      // Ignore already stopped source
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
