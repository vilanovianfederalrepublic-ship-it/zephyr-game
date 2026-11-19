import * as THREE from 'three';

export class PlayerRig {
  public readonly group = new THREE.Group();
  public readonly visuals = new THREE.Group();
  public readonly dropShadow: THREE.Mesh;

  private readonly bodyPivot = new THREE.Group();
  private readonly leftLeg: THREE.Mesh;
  private readonly rightLeg: THREE.Mesh;
  private readonly leftWing: THREE.Mesh;
  private readonly rightWing: THREE.Mesh;
  private readonly visorMat: THREE.MeshStandardMaterial;
  private readonly wingMat: THREE.MeshStandardMaterial;
  private readonly coreMat: THREE.MeshStandardMaterial;

  private runPhase = 0;
  private squashY = 1;
  private squashVel = 0;
  private wingOpen = 0;
  private ascendant = false;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(scene: THREE.Scene) {
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x1e5fd9,
      roughness: 0.45,
      metalness: 0.15,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.25,
      metalness: 0.65,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x10203a,
      roughness: 0.55,
      metalness: 0.3,
    });
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x00ffd5,
      emissive: 0x00b89c,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.5,
    });
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x00ffd5,
      emissive: 0x00ffd5,
      emissiveIntensity: 1.1,
      roughness: 0.1,
      metalness: 0.8,
    });
    this.wingMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      roughness: 0.25,
      metalness: 0.45,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });

    this.materials.push(suitMat, trimMat, darkMat, this.coreMat, this.visorMat, this.wingMat);

    // 1 & 2. Legs / Boots (pivoted at hip)
    const legGeo = new THREE.BoxGeometry(0.24, 0.58, 0.26);
    legGeo.translate(0, -0.29, 0);
    this.geometries.push(legGeo);

    this.leftLeg = new THREE.Mesh(legGeo, darkMat);
    this.leftLeg.position.set(-0.18, 0.58, 0);
    this.leftLeg.castShadow = true;

    this.rightLeg = new THREE.Mesh(legGeo, darkMat);
    this.rightLeg.position.set(0.18, 0.58, 0);
    this.rightLeg.castShadow = true;

    this.bodyPivot.add(this.leftLeg, this.rightLeg);

    // 3. Sculpted Torso
    const torsoGeo = new THREE.CylinderGeometry(0.36, 0.28, 0.72, 10);
    this.geometries.push(torsoGeo);
    const torso = new THREE.Mesh(torsoGeo, suitMat);
    torso.position.y = 0.94;
    torso.castShadow = true;
    this.bodyPivot.add(torso);

    // 4. Shoulder / Chest Collar
    const chestGeo = new THREE.BoxGeometry(0.78, 0.24, 0.44);
    this.geometries.push(chestGeo);
    const chest = new THREE.Mesh(chestGeo, trimMat);
    chest.position.y = 1.16;
    chest.castShadow = true;
    this.bodyPivot.add(chest);

    // 5. Wind-Pack Backpack + Core
    const packGeo = new THREE.BoxGeometry(0.46, 0.5, 0.24);
    const coreGeo = new THREE.OctahedronGeometry(0.14, 0);
    this.geometries.push(packGeo, coreGeo);

    const pack = new THREE.Mesh(packGeo, darkMat);
    pack.position.set(0, 1.0, 0.28);
    pack.castShadow = true;
    this.bodyPivot.add(pack);

    const packCore = new THREE.Mesh(coreGeo, this.coreMat);
    packCore.position.set(0, 1.02, 0.42);
    this.bodyPivot.add(packCore);

    // 6 & 7. Aero Glider Wings (unfold during Wind Glide or Ascendant mode)
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.14);
    wingShape.lineTo(1.25, 0.34);
    wingShape.lineTo(1.05, -0.22);
    wingShape.lineTo(0.18, -0.18);
    wingShape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2,
    });
    this.geometries.push(wingGeo);

    this.leftWing = new THREE.Mesh(wingGeo, this.wingMat);
    this.leftWing.position.set(-0.18, 1.08, 0.34);
    this.leftWing.scale.x = -1;
    this.bodyPivot.add(this.leftWing);

    this.rightWing = new THREE.Mesh(wingGeo, this.wingMat);
    this.rightWing.position.set(0.18, 1.08, 0.34);
    this.bodyPivot.add(this.rightWing);

    // 8, 9, 10. Head, Crest, & Dash-Reactive Visor
    const headGeo = new THREE.SphereGeometry(0.32, 14, 14);
    const visorGeo = new THREE.BoxGeometry(0.44, 0.15, 0.24);
    const crestGeo = new THREE.BoxGeometry(0.1, 0.18, 0.42);
    this.geometries.push(headGeo, visorGeo, crestGeo);

    const head = new THREE.Mesh(headGeo, suitMat);
    head.position.y = 1.58;
    head.castShadow = true;
    this.bodyPivot.add(head);

    const visor = new THREE.Mesh(visorGeo, this.visorMat);
    visor.position.set(0, 1.58, -0.22);
    this.bodyPivot.add(visor);

    const crest = new THREE.Mesh(crestGeo, trimMat);
    crest.position.set(0, 1.84, 0.02);
    this.bodyPivot.add(crest);

    this.visuals.add(this.bodyPivot);
    this.group.add(this.visuals);
    scene.add(this.group);

    // Grounding drop shadow decal
    const shadowGeo = new THREE.CircleGeometry(0.68, 20);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x041020,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.geometries.push(shadowGeo);
    this.materials.push(shadowMat);

    this.dropShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.dropShadow.rotation.x = -Math.PI / 2;
    scene.add(this.dropShadow);
  }

  public triggerSquash(targetScaleY: number): void {
    this.squashY = targetScaleY;
  }

  public setAscendant(unlocked: boolean): void {
    this.ascendant = unlocked;
    if (unlocked) {
      this.wingMat.color.setHex(0xffd700);
      this.wingMat.emissive.setHex(0xf59e0b);
      this.wingMat.emissiveIntensity = 0.95;
      this.coreMat.color.setHex(0xffd700);
      this.coreMat.emissive.setHex(0xf59e0b);
    } else {
      this.wingMat.color.setHex(0x38bdf8);
      this.wingMat.emissive.setHex(0x0284c7);
      this.wingMat.emissiveIntensity = 0.6;
      this.coreMat.color.setHex(0x00ffd5);
      this.coreMat.emissive.setHex(0x00b89c);
    }
  }

  public update(
    dt: number,
    horizSpeed: number,
    vertSpeed: number,
    isGrounded: boolean,
    isDashing: boolean,
    canAirDash: boolean,
    isGliding: boolean,
    turnDelta: number,
  ): void {
    // Spring recovery for squash-and-stretch
    const springForce = (1 - this.squashY) * 140 - this.squashVel * 14;
    this.squashVel += springForce * dt;
    this.squashY += this.squashVel * dt;
    const xzScale = 1 / Math.sqrt(Math.max(0.55, this.squashY));
    this.bodyPivot.scale.set(xzScale, Math.max(0.55, this.squashY), xzScale);

    // Visor & pack dash-readiness feedback
    if (this.ascendant) {
      this.visorMat.color.setHex(0xffdf4d);
      this.visorMat.emissive.setHex(0xffb700);
      this.visorMat.emissiveIntensity = isDashing ? 2.0 : 1.2;
    } else if (canAirDash || isDashing) {
      this.visorMat.color.setHex(0x00ffd5);
      this.visorMat.emissive.setHex(0x00ffd5);
      this.visorMat.emissiveIntensity = isDashing ? 2.0 : 1.1;
    } else {
      this.visorMat.color.setHex(0x475569);
      this.visorMat.emissive.setHex(0x1e293b);
      this.visorMat.emissiveIntensity = 0.3;
    }

    // Running stride vs. airborne tuck
    if (isGrounded && horizSpeed > 0.8) {
      this.runPhase += dt * (4.5 + horizSpeed * 0.65);
      const swing = Math.sin(this.runPhase) * Math.min(0.75, horizSpeed * 0.055);
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.bodyPivot.position.y = Math.abs(Math.cos(this.runPhase)) * 0.06;
    } else if (!isGrounded) {
      const airBlend = 1 - Math.exp(-10 * dt);
      this.leftLeg.rotation.x += (0.28 - this.leftLeg.rotation.x) * airBlend;
      this.rightLeg.rotation.x += (-0.36 - this.rightLeg.rotation.x) * airBlend;
      this.bodyPivot.position.y += (0 - this.bodyPivot.position.y) * airBlend;
    } else {
      const idleBlend = 1 - Math.exp(-12 * dt);
      this.leftLeg.rotation.x *= 1 - idleBlend;
      this.rightLeg.rotation.x *= 1 - idleBlend;
      this.bodyPivot.position.y *= 1 - idleBlend;
    }

    // Forward lean & turn banking
    const targetPitch = isDashing
      ? -0.48
      : isGliding
        ? -0.25
        : -Math.min(0.24, horizSpeed * 0.015) + (isGrounded ? 0 : Math.max(-0.14, Math.min(0.14, -vertSpeed * 0.008)));
    const targetBank = Math.max(-0.3, Math.min(0.3, turnDelta * 0.35));
    const tiltBlend = 1 - Math.exp(-12 * dt);
    this.bodyPivot.rotation.x += (targetPitch - this.bodyPivot.rotation.x) * tiltBlend;
    this.bodyPivot.rotation.z += (targetBank - this.bodyPivot.rotation.z) * tiltBlend;

    // Wing unfold animation (always partially visible in Ascendant mode, full during Glide or Dash)
    const targetWing = isGliding ? 1 : isDashing ? 0.85 : this.ascendant ? 0.52 : 0.08;
    this.wingOpen += (targetWing - this.wingOpen) * (1 - Math.exp(-14 * dt));
    const flap = isGliding ? Math.sin(performance.now() * 0.012) * 0.14 : 0;

    this.leftWing.visible = this.wingOpen > 0.1;
    this.rightWing.visible = this.wingOpen > 0.1;
    this.leftWing.scale.set(-this.wingOpen, 0.4 + this.wingOpen * 0.6, 1);
    this.rightWing.scale.set(this.wingOpen, 0.4 + this.wingOpen * 0.6, 1);
    this.leftWing.rotation.y = 0.25 - this.wingOpen * 0.15;
    this.rightWing.rotation.y = -(0.25 - this.wingOpen * 0.15);
    this.leftWing.rotation.z = -flap;
    this.rightWing.rotation.z = flap;
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
