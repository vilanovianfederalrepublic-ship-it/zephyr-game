import * as THREE from 'three';

interface ParticleSlot {
  active: boolean;
  age: number;
  life: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  gravity: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 280;
const _dummy = new THREE.Object3D();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export class ParticleSystem {
  public readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly slots: ParticleSlot[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.OctahedronGeometry(0.24, 0);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.slots.push({
        active: false,
        age: 0,
        life: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        size: 1,
        gravity: 0,
        color: new THREE.Color(0xffffff),
      });
      this.mesh.setMatrixAt(i, _zeroMatrix);
      this.mesh.setColorAt(i, new THREE.Color(0xffffff));
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    size: number,
    life: number,
    gravity = 0,
  ): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.pos.set(x, y, z);
    slot.vel.set(vx, vy, vz);
    slot.size = size;
    slot.gravity = gravity;
    slot.color.setHex(colorHex);
    this.mesh.setColorAt(this.cursor === 0 ? MAX_PARTICLES - 1 : this.cursor - 1, slot.color);
  }

  public emitBurst(
    pos: THREE.Vector3,
    count: number,
    colorHex: number,
    speed: number,
    size: number,
    life: number,
    upwardBias = 0.4,
    gravity = 10,
  ): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.65;
      const s = speed * (0.55 + Math.random() * 0.7);
      const vx = Math.cos(theta) * Math.sin(phi) * s;
      const vy = (Math.cos(phi) * 0.5 + upwardBias) * s;
      const vz = Math.sin(theta) * Math.sin(phi) * s;
      this.spawn(pos.x, pos.y, pos.z, vx, vy, vz, colorHex, size * (0.7 + Math.random() * 0.6), life, gravity);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public emitLandingRing(pos: THREE.Vector3, colorHex = 0xdff6ff): void {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.25;
      const spd = 4.2 + Math.random() * 2.5;
      this.spawn(
        pos.x + Math.cos(a) * 0.35,
        pos.y + 0.08,
        pos.z + Math.sin(a) * 0.35,
        Math.cos(a) * spd,
        1.1 + Math.random() * 0.8,
        Math.sin(a) * spd,
        colorHex,
        0.55,
        0.38,
        4,
      );
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public emitDashTrail(pos: THREE.Vector3, dir: THREE.Vector3, colorHex = 0x00ffd5): void {
    for (let i = 0; i < 4; i++) {
      this.spawn(
        pos.x + (Math.random() - 0.5) * 0.6,
        pos.y + 0.8 + (Math.random() - 0.5) * 0.6,
        pos.z + (Math.random() - 0.5) * 0.6,
        -dir.x * (6 + Math.random() * 6) + (Math.random() - 0.5) * 2.5,
        (Math.random() - 0.5) * 2.2,
        -dir.z * (6 + Math.random() * 6) + (Math.random() - 0.5) * 2.5,
        colorHex,
        0.75 + Math.random() * 0.45,
        0.32,
        0,
      );
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public emitUpdraftMote(pos: THREE.Vector3, colorHex = 0xffe066): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.7 + Math.random() * 1.1;
    this.spawn(
      pos.x + Math.cos(angle) * radius,
      pos.y - 0.4,
      pos.z + Math.sin(angle) * radius,
      (Math.random() - 0.5) * 0.5,
      8.5 + Math.random() * 4,
      (Math.random() - 0.5) * 0.5,
      colorHex,
      0.42,
      0.75,
      -2,
    );
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public update(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const slot = this.slots[i];
      if (!slot.active) continue;

      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.active = false;
        this.mesh.setMatrixAt(i, _zeroMatrix);
        continue;
      }

      anyActive = true;
      slot.vel.y -= slot.gravity * dt;
      slot.pos.addScaledVector(slot.vel, dt);

      const t = 1 - slot.age / slot.life;
      const scale = slot.size * Math.sin(t * Math.PI * 0.5);
      _dummy.position.copy(slot.pos);
      _dummy.rotation.set(slot.age * 4, slot.age * 3, 0);
      _dummy.scale.setScalar(Math.max(0.001, scale));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }

    if (anyActive || this.mesh.instanceMatrix.needsUpdate) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
