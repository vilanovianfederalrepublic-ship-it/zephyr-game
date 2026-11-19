import * as THREE from 'three';

export interface StaticCollider {
  box: THREE.Box3;
  isClimbableTop: boolean;
}

export interface MovingPlatform {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  speed: number;
  progress: number;
  size: { x: number; y: number; z: number };
  delta: THREE.Vector3;
  collider: THREE.Box3;
  prevMaxY: number;
  phaseOffset: number;
}

export interface CheckpointData {
  stageIndex: number;
  name: string;
  position: THREE.Vector3;
  halo: THREE.Mesh;
  pillar: THREE.Mesh;
  beam: THREE.Mesh;
  active: boolean;
}

export interface UpdraftData {
  mesh: THREE.Mesh;
  rings: THREE.Mesh[];
  pos: THREE.Vector3;
  boost: number;
  cooldown: number;
  ascendantOnly?: boolean;
  group: THREE.Group;
}

export interface ShardData {
  id: number;
  name: string;
  group: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  pos: THREE.Vector3;
  collected: boolean;
}

export interface StageAtmosphere {
  skyHex: number;
  fogHex: number;
  fogDensity: number;
}

export const STAGE_ATMOSPHERES: StageAtmosphere[] = [
  { skyHex: 0x66b4ec, fogHex: 0x7bc2f2, fogDensity: 0.0052 }, // Stage 1: Aether Sanctuary
  { skyHex: 0x4ca9b8, fogHex: 0x62bec9, fogDensity: 0.0054 }, // Stage 2: Whispering Isle
  { skyHex: 0x5c89c9, fogHex: 0x82a7db, fogDensity: 0.0050 }, // Stage 3: Chronos Haven
  { skyHex: 0x3b5998, fogHex: 0x5876b5, fogDensity: 0.0054 }, // Stage 4: Aero Citadel
  { skyHex: 0x2c3e78, fogHex: 0x6f689d, fogDensity: 0.0046 }, // Stage 5: Celestial Spire
  { skyHex: 0x1b2452, fogHex: 0x4b427f, fogDensity: 0.0040 }, // Stage 6: Astral Crown
];

export interface WorldData {
  colliders: StaticCollider[];
  movingPlatforms: MovingPlatform[];
  checkpoints: CheckpointData[];
  updraftRings: UpdraftData[];
  shards: ShardData[];
  finalCheckpoint: CheckpointData;
  crownCheckpoint: CheckpointData;
  gearRings: THREE.Mesh[];
  ascendantGateRing: UpdraftData;
  ascendantBridgeGroup: THREE.Group;
  setCheckpointActive: (cp: CheckpointData, active: boolean) => void;
  resetShards: () => void;
  dispose: () => void;
}

export function buildWorld(scene: THREE.Scene): WorldData {
  const colliders: StaticCollider[] = [];
  const movingPlatforms: MovingPlatform[] = [];
  const checkpoints: CheckpointData[] = [];
  const updraftRings: UpdraftData[] = [];
  const shards: ShardData[] = [];
  const gearRings: THREE.Mesh[] = [];

  // Shared Unit Geometries (Reused across every island, platform, cloud & prop)
  const sharedGeo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(0.7, 1, 6),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    pillar: new THREE.CylinderGeometry(0.45, 0.78, 4.2, 8),
    torus: new THREE.TorusGeometry(1.25, 0.14, 10, 24),
    updraftTorus: new THREE.TorusGeometry(2.15, 0.22, 8, 22),
    windRing: new THREE.TorusGeometry(1.65, 0.07, 6, 20),
    shard: new THREE.OctahedronGeometry(1.15, 0),
    shardHalo: new THREE.TorusGeometry(1.75, 0.06, 6, 24),
    cloud: new THREE.DodecahedronGeometry(14, 1),
    crystal: new THREE.OctahedronGeometry(0.75, 0),
    beam: new THREE.CylinderGeometry(0.45, 1.35, 36, 12, 1, true),
    gear: new THREE.TorusGeometry(4.2, 0.22, 6, 16),
  };

  // Biome & Prop PBR Materials
  const materials = {
    grassEmerald: new THREE.MeshStandardMaterial({ color: 0x45b858, roughness: 0.78, metalness: 0.04 }),
    grassJade: new THREE.MeshStandardMaterial({ color: 0x2fb58d, roughness: 0.72, metalness: 0.08 }),
    stoneChronos: new THREE.MeshStandardMaterial({ color: 0xd99b43, roughness: 0.55, metalness: 0.28 }),
    stoneTempest: new THREE.MeshStandardMaterial({ color: 0x5c759e, roughness: 0.62, metalness: 0.22 }),
    marbleCelestial: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.35 }),
    rockBase: new THREE.MeshStandardMaterial({ color: 0x5d534b, roughness: 0.9, metalness: 0.05 }),
    trimLight: new THREE.MeshStandardMaterial({ color: 0xeef6ff, roughness: 0.4, metalness: 0.2 }),
    trimGold: new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.25, metalness: 0.75 }),
    platform: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.42, metalness: 0.32 }),
    platformHigh: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35, metalness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.85, roughness: 0.18 }),
    checkpointOff: new THREE.MeshStandardMaterial({ color: 0x475569, emissive: 0x0f172a, roughness: 0.5, metalness: 0.4 }),
    checkpointOn: new THREE.MeshStandardMaterial({ color: 0x00ffd5, emissive: 0x00bfa5, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.6 }),
    beamOff: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    beamGoal: new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    shardMat: new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xbe123c, emissiveIntensity: 0.85, roughness: 0.15, metalness: 0.6 }),
    shardHaloMat: new THREE.MeshStandardMaterial({ color: 0xfda4af, emissive: 0xf43f5e, emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.7 }),
    windColumn: new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.38, depthWrite: false }),
    cloud: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 }),
    flora: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 }),
  };

  // Instanced Atmospheric Cloud Archipelago (1 draw call for 92 cloud puffs)
  const cloudCount = 92;
  const cloudInst = new THREE.InstancedMesh(sharedGeo.cloud, materials.cloud, cloudCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < cloudCount; i++) {
    const zPos = 40 - Math.random() * 470;
    const xPos = (Math.random() - 0.5) * 440;
    const yPos = -24 - Math.random() * 55 + Math.max(0, -zPos * 0.08);
    const s = 0.9 + Math.random() * 2.3;
    dummy.position.set(xPos, yPos, zPos);
    dummy.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
    dummy.scale.set(s * 1.9, s * 0.72, s * 1.25);
    dummy.updateMatrix();
    cloudInst.setMatrixAt(i, dummy.matrix);
  }
  cloudInst.instanceMatrix.needsUpdate = true;
  cloudInst.computeBoundingSphere();
  scene.add(cloudInst);

  // Collect decorative crystal/flora matrices for a single InstancedMesh
  const propTransforms: { matrix: THREE.Matrix4; color: number }[] = [];

  type TopStyle = 'emerald' | 'jade' | 'chronos' | 'tempest' | 'celestial';
  const styleToMat: Record<TopStyle, THREE.MeshStandardMaterial> = {
    emerald: materials.grassEmerald,
    jade: materials.grassJade,
    chronos: materials.stoneChronos,
    tempest: materials.stoneTempest,
    celestial: materials.marbleCelestial,
  };

  function addIslandProp(x: number, y: number, z: number, color: number, scale = 1): void {
    dummy.position.set(x, y + 0.55 * scale, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2);
    dummy.scale.set(scale * 0.75, scale * 1.25, scale * 0.75);
    dummy.updateMatrix();
    propTransforms.push({ matrix: dummy.matrix.clone(), color });
  }

  function buildIsland(
    x: number,
    y: number,
    z: number,
    w: number,
    l: number,
    depth = 8,
    style: TopStyle = 'emerald',
    parentGroup?: THREE.Group,
  ): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const slabH = 1.6;
    const slab = new THREE.Mesh(sharedGeo.box, styleToMat[style]);
    slab.scale.set(w, slabH, l);
    slab.position.y = -slabH / 2;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    // Crisp rim trim for high-visibility depth perception against sky
    const trimMat = style === 'chronos' || style === 'celestial' ? materials.trimGold : materials.trimLight;
    const trim = new THREE.Mesh(sharedGeo.box, trimMat);
    trim.scale.set(w + 0.16, 0.22, l + 0.16);
    trim.position.y = -0.14;
    trim.receiveShadow = true;
    group.add(trim);

    // Tapered rock underbelly
    const baseRadius = Math.min(w, l);
    const bottom = new THREE.Mesh(sharedGeo.cone, materials.rockBase);
    bottom.scale.set(baseRadius, depth, baseRadius);
    bottom.position.y = -depth / 2 - slabH;
    bottom.rotation.x = Math.PI;
    bottom.receiveShadow = true;
    group.add(bottom);

    // Add subtle corner sky-crystals on medium/large islands
    if (w >= 9 && !parentGroup) {
      const propColor =
        style === 'emerald'
          ? 0x34d399
          : style === 'jade'
            ? 0x2dd4bf
            : style === 'chronos'
              ? 0xfbbf24
              : style === 'tempest'
                ? 0x60a5fa
                : 0xfef08a;
      addIslandProp(x - w * 0.36, y, z - l * 0.36, propColor, 1.05);
      addIslandProp(x + w * 0.36, y, z + l * 0.36, propColor, 0.9);
      addIslandProp(x + w * 0.36, y, z - l * 0.36, propColor, 0.8);
    }

    (parentGroup ?? scene).add(group);

    // Full 3D AABB collider (top, sides, and bottom!)
    colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - w / 2, y - slabH, z - l / 2),
        new THREE.Vector3(x + w / 2, y, z + l / 2),
      ),
      isClimbableTop: true,
    });
  }

  function buildMovingPlatform(
    start: THREE.Vector3,
    end: THREE.Vector3,
    speed: number,
    size = { x: 5.2, y: 1.05, z: 5.2 },
    highVis = false,
  ): MovingPlatform {
    const mesh = new THREE.Mesh(sharedGeo.box, highVis ? materials.platformHigh : materials.platform);
    mesh.scale.set(size.x, size.y, size.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(start);

    // Rim highlight bar on moving platform
    const rim = new THREE.Mesh(sharedGeo.box, materials.trimLight);
    rim.scale.set(1.03, 0.22, 1.03);
    rim.position.y = 0.35;
    mesh.add(rim);

    scene.add(mesh);

    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const halfZ = size.z / 2;
    const collider = new THREE.Box3(
      new THREE.Vector3(start.x - halfX, start.y - halfY, start.z - halfZ),
      new THREE.Vector3(start.x + halfX, start.y + halfY, start.z + halfZ),
    );

    const pData: MovingPlatform = {
      mesh,
      start: start.clone(),
      end: end.clone(),
      speed,
      progress: 0,
      phaseOffset: (movingPlatforms.length * 0.85) % (Math.PI * 2),
      size,
      delta: new THREE.Vector3(),
      collider,
      prevMaxY: start.y + halfY,
    };
    pData.progress = pData.phaseOffset;
    movingPlatforms.push(pData);
    return pData;
  }

  function buildCheckpoint(
    stageIndex: number,
    x: number,
    y: number,
    z: number,
    name: string,
    isGoal = false,
    parentGroup?: THREE.Group,
  ): CheckpointData {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const pillar = new THREE.Mesh(sharedGeo.pillar, materials.checkpointOff);
    pillar.position.y = 2.1;
    pillar.castShadow = true;
    group.add(pillar);

    const halo = new THREE.Mesh(sharedGeo.torus, materials.checkpointOff);
    halo.position.y = 3.5;
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    const beam = new THREE.Mesh(sharedGeo.beam, isGoal ? materials.beamGoal : materials.beamOff);
    beam.position.y = 18;
    group.add(beam);

    (parentGroup ?? scene).add(group);

    // Solid pillar collider so player doesn't walk inside checkpoint obelisk
    colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - 0.65, y, z - 0.65), new THREE.Vector3(x + 0.65, y + 3.8, z + 0.65)),
      isClimbableTop: false,
    });

    const cp: CheckpointData = {
      stageIndex,
      name,
      position: new THREE.Vector3(x, y + 1.2, z),
      halo,
      pillar,
      beam,
      active: false,
    };
    checkpoints.push(cp);
    return cp;
  }

  function buildUpdraft(x: number, y: number, z: number, boost = 23, ascendantOnly = false): UpdraftData {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const ring = new THREE.Mesh(sharedGeo.updraftTorus, materials.gold);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const windRing = new THREE.Mesh(sharedGeo.windRing, materials.windColumn);
      windRing.rotation.x = Math.PI / 2;
      windRing.position.y = i * 2.2;
      group.add(windRing);
      rings.push(windRing);
    }

    if (ascendantOnly) {
      group.visible = false;
    }

    scene.add(group);
    const data: UpdraftData = {
      mesh: ring,
      rings,
      pos: new THREE.Vector3(x, y, z),
      boost,
      cooldown: 0,
      ascendantOnly,
      group,
    };
    updraftRings.push(data);
    return data;
  }

  function buildShard(id: number, name: string, x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const core = new THREE.Mesh(sharedGeo.shard, materials.shardMat);
    const ring = new THREE.Mesh(sharedGeo.shardHalo, materials.shardHaloMat);
    ring.rotation.x = Math.PI / 3;
    group.add(core, ring);

    scene.add(group);
    shards.push({
      id,
      name,
      group,
      core,
      ring,
      pos: new THREE.Vector3(x, y, z),
      collected: false,
    });
  }

  /* =========================================================================
     STAGE 1: AETHER SANCTUARY (Expanded Start + Optional Express Route)
     ========================================================================= */
  buildIsland(0, 0, 0, 18, 18, 10, 'emerald');
  buildCheckpoint(0, 0, 0, 0, 'Stage 1: Aether Sanctuary');

  buildIsland(0, 1.0, -15, 5.5, 5.5, 5, 'emerald');
  buildIsland(-5.5, 2.0, -24.5, 5, 5, 5, 'emerald');
  buildIsland(3.5, 3.0, -34, 5, 5, 5, 'emerald');
  buildIsland(-1.5, 3.8, -42.5, 4.5, 4.5, 4, 'emerald');

  // Optional left flank sky-stones for speedrunners
  buildIsland(-11, 2.5, -34, 4, 4, 4, 'emerald');
  buildIsland(-10, 3.8, -46, 4.2, 4.2, 4, 'emerald');
  buildUpdraft(-10, 5.2, -52, 20);

  buildMovingPlatform(new THREE.Vector3(0, 4.2, -51), new THREE.Vector3(0, 4.2, -70), 1.35);

  /* =========================================================================
     STAGE 2: WHISPERING ISLE & DEPTHS
     ========================================================================= */
  buildIsland(0, 5, -84, 19, 19, 10, 'jade');
  buildCheckpoint(1, 0, 5, -84, 'Stage 2: Whispering Isle');

  // Secret 1: Whispering Depths (Right Flank)
  buildIsland(14.5, 1.0, -84, 4.6, 4.6, 4, 'jade');
  buildIsland(22.5, -1.5, -92, 4.2, 4.2, 4, 'jade');
  buildIsland(22.5, -3.0, -104, 5.8, 5.8, 5, 'jade');
  buildShard(1, 'Whisper Shard', 22.5, -0.6, -104);
  buildUpdraft(13.5, 1.5, -99, 23);

  // Additional breather stepping stone onto Clockwork Straits
  buildIsland(0, 6.2, -97, 5, 4.5, 4, 'jade');

  /* =========================================================================
     STAGE 3: CLOCKWORK STRAITS & CHRONOS HAVEN
     ========================================================================= */
  buildMovingPlatform(new THREE.Vector3(-11, 7.2, -107), new THREE.Vector3(11, 7.2, -107), 1.85);
  buildIsland(-12, 8.8, -118, 4.4, 4.4, 4, 'chronos'); // Optional side stone
  buildMovingPlatform(new THREE.Vector3(0, 9.0, -122), new THREE.Vector3(0, 15.5, -122), 1.45, { x: 5.5, y: 1.05, z: 5.5 }, true);

  // Decorative spinning clockwork rings around Stage 3
  [-107, -122].forEach((zPos, idx) => {
    const gear = new THREE.Mesh(sharedGeo.gear, materials.trimGold);
    gear.position.set(0, 11 + idx * 3, zPos);
    gear.rotation.x = Math.PI / 2.4;
    scene.add(gear);
    gearRings.push(gear);
  });

  buildIsland(0, 16, -142, 19, 19, 11, 'chronos');
  buildCheckpoint(2, 0, 16, -142, 'Stage 3: Chronos Haven');

  // Secret 2: Gear-works Grotto (Tucked behind Chronos Haven)
  buildIsland(0, 12, -156, 4.6, 4.6, 4, 'chronos');
  buildMovingPlatform(new THREE.Vector3(-6, 12, -165), new THREE.Vector3(-13.5, 12, -165), 1.25, { x: 4.0, y: 1.0, z: 4.0 });
  buildIsland(-20, 12, -165, 5.2, 5.2, 4, 'chronos');
  buildShard(2, 'Chronos Shard', -20, 14.3, -165);
  buildUpdraft(-19, 13.5, -151, 25);

  /* =========================================================================
     STAGE 4: TEMPEST CAUSEWAY & AERO CITADEL
     ========================================================================= */
  buildIsland(10, 18, -168, 5, 5, 5, 'tempest');
  buildIsland(16.5, 20, -182, 5, 5, 5, 'tempest');
  buildIsland(8.5, 22, -196, 5, 5, 5, 'tempest');
  buildIsland(-3.5, 22.8, -206, 4.5, 4.5, 4, 'tempest'); // Added intermediate island

  // High-altitude skiff + side stone
  buildMovingPlatform(new THREE.Vector3(7.5, 23.5, -214), new THREE.Vector3(-7.5, 25.5, -228), 2.1, { x: 5.5, y: 1.05, z: 5.5 }, true);

  // Updraft launcher to high aerial pinnacle (Secret 3)
  buildUpdraft(0, 26.2, -238, 28);
  buildIsland(-16.5, 36, -238, 5.2, 5.2, 6, 'tempest');
  buildIsland(-9, 31.5, -245, 4.2, 4.2, 4, 'tempest'); // Safe step-down return island
  buildShard(3, 'Tempest Shard', -16.5, 38.4, -238);

  buildIsland(0, 28, -258, 21, 21, 12, 'tempest');
  buildCheckpoint(3, 0, 28, -258, 'Stage 4: Aero Citadel');

  /* =========================================================================
     STAGE 5: CELESTIAL STRATOSPHERE (GRAND SUMMIT)
     ========================================================================= */
  buildIsland(0, 29.5, -271, 5, 5, 4, 'celestial');
  buildMovingPlatform(new THREE.Vector3(-11, 31.5, -281), new THREE.Vector3(11, 31.5, -281), 2.0);
  buildMovingPlatform(new THREE.Vector3(8, 35, -296), new THREE.Vector3(-8, 37, -296), 1.85);
  buildIsland(0, 38, -306, 4.8, 4.8, 4, 'celestial');
  buildMovingPlatform(new THREE.Vector3(0, 39, -315), new THREE.Vector3(0, 45.5, -315), 1.5, { x: 5.5, y: 1.05, z: 5.5 }, true);

  // Grand Summit Monolith Island
  buildIsland(0, 46, -334, 24, 24, 15, 'celestial');
  const finalCheckpoint = buildCheckpoint(4, 0, 46, -334, 'Stage 5: Celestial Spire', true);

  // Sculpted Monolith Tower with full solid collider
  const monolithGroup = new THREE.Group();
  monolithGroup.position.set(0, 46, -334);
  const plinth = new THREE.Mesh(sharedGeo.box, materials.marbleCelestial);
  plinth.scale.set(6.5, 1.2, 6.5);
  plinth.position.y = 0.6;
  plinth.receiveShadow = true;
  monolithGroup.add(plinth);

  const spireCol = new THREE.Mesh(sharedGeo.cyl, materials.gold);
  spireCol.scale.set(1.75, 12.5, 1.75);
  spireCol.position.set(0, 6.8, -5.5);
  spireCol.castShadow = true;
  monolithGroup.add(spireCol);

  const spireCrown = new THREE.Mesh(sharedGeo.shard, materials.trimGold);
  spireCrown.scale.set(1.6, 2.2, 1.6);
  spireCrown.position.set(0, 14.5, -5.5);
  monolithGroup.add(spireCrown);
  scene.add(monolithGroup);

  colliders.push({
    box: new THREE.Box3(new THREE.Vector3(-1.8, 46, -341.3), new THREE.Vector3(1.8, 59, -337.7)),
    isClimbableTop: false,
  });

  // Secret 4: Blind-Leap Alcove beneath Celestial Summit
  buildIsland(0, 39.5, -352, 5.8, 5.8, 4, 'celestial');
  buildShard(4, 'Celestial Shard', 0, 41.8, -352);
  buildUpdraft(0, 41, -345, 26);

  /* =========================================================================
     STAGE 6: ASTRAL CROWN (UNLOCKED BY COLLECTING ALL 4 ECHO SHARDS)
     ========================================================================= */
  const ascendantBridgeGroup = new THREE.Group();
  ascendantBridgeGroup.visible = false;
  scene.add(ascendantBridgeGroup);

  const ascendantGateRing = buildUpdraft(0, 48.5, -342, 30, true);

  // Bonus floating crown sanctuary high above the spire
  buildIsland(0, 62, -358, 6.5, 6.5, 5, 'celestial', ascendantBridgeGroup);
  buildIsland(-8, 65, -370, 5.5, 5.5, 4, 'celestial', ascendantBridgeGroup);
  buildIsland(8, 67, -380, 5.5, 5.5, 4, 'celestial', ascendantBridgeGroup);
  buildIsland(0, 70, -396, 16, 16, 10, 'celestial', ascendantBridgeGroup);
  const crownCheckpoint = buildCheckpoint(5, 0, 70, -396, 'Bonus: Astral Crown', true, ascendantBridgeGroup);

  // Build single InstancedMesh for all decorative island crystals
  if (propTransforms.length > 0) {
    const propInst = new THREE.InstancedMesh(sharedGeo.crystal, materials.flora, propTransforms.length);
    const col = new THREE.Color();
    propTransforms.forEach((p, idx) => {
      propInst.setMatrixAt(idx, p.matrix);
      col.setHex(p.color);
      propInst.setColorAt(idx, col);
    });
    propInst.instanceMatrix.needsUpdate = true;
    if (propInst.instanceColor) propInst.instanceColor.needsUpdate = true;
    propInst.computeBoundingSphere();
    scene.add(propInst);
  }

  return {
    colliders,
    movingPlatforms,
    checkpoints,
    updraftRings,
    shards,
    finalCheckpoint,
    crownCheckpoint,
    gearRings,
    ascendantGateRing,
    ascendantBridgeGroup,
    setCheckpointActive: (cp: CheckpointData, active: boolean) => {
      cp.active = active;
      cp.halo.material = active ? materials.checkpointOn : materials.checkpointOff;
      cp.pillar.material = active ? materials.checkpointOn : materials.checkpointOff;
    },
    resetShards: () => {
      shards.forEach((sh) => {
        sh.collected = false;
        sh.group.visible = true;
      });
    },
    dispose: () => {
      Object.values(sharedGeo).forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}
