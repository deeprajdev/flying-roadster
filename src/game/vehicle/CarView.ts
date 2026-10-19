import * as THREE from 'three';
import { clamp, dampK } from '../core/math';
import type { Particles } from '../fx/Particles';
import { newFrame, type TrackData } from '../track/TrackData';
import type { CarState } from './CarPhysics';
import { buildRoadster, type RoadsterParts } from './RoadsterModel';
import { IS_TOUCH } from '../device';

const F = newFrame();
const vF = new THREE.Vector3(), vU = new THREE.Vector3(), vX = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const qTrick = new THREE.Quaternion();
const qWob = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const PIVOT = new THREE.Vector3(0, 0.6, 0);
const jd = new THREE.Vector3();
const vp = new THREE.Vector3();

/** Visual representation of one car: syncs the model with physics and drives thrusters / lights / FX. */
export class CarView {
  readonly parts: RoadsterParts;
  readonly isPlayer: boolean;
  /** world-space basis, updated each frame (used by camera & audio) */
  readonly pos = new THREE.Vector3();
  readonly fwd = new THREE.Vector3(0, 0, 1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly vel = new THREE.Vector3();
  private thrust = new Float32Array(10);
  private pitch = 0;
  private roll = 0;
  private boostLight: THREE.PointLight | null = null;
  private liftLight: THREE.PointLight | null = null;
  private time = Math.random() * 10;
  private launchFlash = 0;
  private wobble = 0;
  smokeTint: [number, number, number] = [0.75, 0.75, 0.78];

  private night: boolean;
  private realShadows: boolean;

  constructor(color: number, accent: number, envMap: THREE.Texture | null, isPlayer: boolean, headlights: boolean, night = false, realShadows = false) {
    this.parts = buildRoadster(color, accent, envMap);
    this.isPlayer = isPlayer;
    this.night = night;
    this.realShadows = realShadows;
    this.parts.beams.visible = night;
    this.parts.headMat.emissiveIntensity = night ? 3 : 1.4;
    if (realShadows) this.setRealShadows(true);
    if (isPlayer) {
      const bl = new THREE.PointLight(0x5aa8ff, 0, 14, 2);
      bl.position.set(0, 0.6, -3.2);
      this.parts.body.add(bl);
      this.boostLight = bl;
      if (!IS_TOUCH) {
        // the vapour columns light up the road under the car, like the floodlit demo
        const ll = new THREE.PointLight(0xcfe6ff, 0, 22, 1.6);
        ll.position.set(0, -0.6, 0);
        this.parts.body.add(ll);
        this.liftLight = ll;
      }
      if (headlights) {
        const spot = new THREE.SpotLight(0xe8f2ff, 14, 80, 0.5, 0.7, 1.1);
        spot.position.set(0, 0.75, 2.4);
        spot.target.position.set(0, 0, 26);
        this.parts.body.add(spot, spot.target);
      }
    }
  }

  get root() {
    return this.parts.root;
  }


  /** Real sun shadows (by day on High graphics) or the soft blob under the car. */
  setRealShadows(on: boolean) {
    this.realShadows = on;
    this.parts.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.fx && !m.userData.noShadow && !(m.material as THREE.Material).transparent) m.castShadow = on;
    });
    this.parts.shadow.visible = !on;
  }

  sync(c: CarState, tr: TrackData, dt: number, smoke: Particles, sparks: Particles) {
    this.time += dt;
    const p = this.parts;
    tr.frame(c.s, F);
    const cp = Math.cos(c.psi), sp = Math.sin(c.psi);
    vF.set(F.tx * cp + F.rx * sp, F.ty * cp + F.ry * sp, F.tz * cp + F.rz * sp).normalize();
    vU.set(F.ux, F.uy, F.uz);
    vX.crossVectors(vU, vF).normalize(); // model +X (car's left)
    const h = c.h;
    const prev = tmp.copy(this.pos);
    this.pos.set(F.px + F.rx * c.d + F.ux * h, F.py + F.ry * c.d + F.uy * h, F.pz + F.rz * c.d + F.uz * h);
    if (dt > 0) this.vel.subVectors(this.pos, prev).divideScalar(dt);
    if (this.vel.lengthSq() > 200 * 200) this.vel.set(0, 0, 0);
    this.fwd.copy(vF);
    this.up.copy(vU);
    this.right.copy(vX).negate();
    m4.makeBasis(vX, vU, vF);
    m4.setPosition(this.pos);
    p.root.matrixAutoUpdate = false;
    p.root.matrix.copy(m4);
    p.root.matrixWorldNeedsUpdate = true;

    // suspension feel
    const tp = clamp(-c.longAcc * 0.0035, -0.05, 0.05);
    const tr2 = clamp(-c.latAcc * 0.0028, -0.06, 0.06) + (c.drifting ? -Math.sign(c.slip) * 0.02 : 0);
    this.pitch += (tp - this.pitch) * dampK(8, dt);
    this.roll += (tr2 - this.roll) * dampK(8, dt);
    p.body.rotation.set(this.pitch + (c.grounded ? 0 : -0.04), 0, this.roll);
    p.body.position.y = c.landed > 0 ? -0.08 : p.body.position.y * 0.9;

    // wheels
    const spin = (c.vx * dt) / 0.36;
    for (const w of p.wheels) w.rotation.x += spin;
    for (const s of p.steerPivots) s.rotation.y = -c.steer * 0.42;

    // lights
    const braking = c.input.brake > 0.1 && c.vx > 1;
    p.tailMat.emissiveIntensity = braking ? 7 : this.night ? 2.6 : 1.6;
    if (this.night) {
      // beams follow the car; the light pool only makes sense on the ground
      p.pool.visible = c.grounded && c.trick === 'none' && !c.fallen;
      p.beams.visible = !c.fallen;
    }

    // flips & barrel rolls rotate the whole chassis about its centre of mass
    if (c.badLanding) this.wobble = 1;
    this.wobble = Math.max(0, this.wobble - dt * 1.6);
    const ang = c.trickAngle;
    const ch = p.chassis;
    if (c.trick === 'front') qTrick.setFromAxisAngle(AX, ang);
    else if (c.trick === 'back') qTrick.setFromAxisAngle(AX, -ang);
    else if (c.trick === 'rollR') qTrick.setFromAxisAngle(AZ, ang);
    else if (c.trick === 'rollL') qTrick.setFromAxisAngle(AZ, -ang);
    else qTrick.identity();
    if (this.wobble > 0) qTrick.multiply(qWob.setFromAxisAngle(AZ, Math.sin(this.time * 28) * 0.16 * this.wobble));
    ch.quaternion.copy(qTrick);
    ch.position.copy(PIVOT).sub(tmp.copy(PIVOT).applyQuaternion(qTrick));

    // ---- cold-gas jets ----
    const boost = c.boosting ? 1 : 0;
    const auto = c.autoThrust ? 1 : 0;
    const fly = c.flying ? 1 : 0;
    const rcs = c.trick !== 'none' ? 1 : 0; // attitude jets during flips / rolls
    if (c.launched) this.launchFlash = 1;
    this.launchFlash = Math.max(0, this.launchFlash - dt * 2.5);
    const cloudRate = this.isPlayer ? (IS_TOUCH ? 0.6 : 1.6) : 0.25;
    let liftSum = 0;
    for (let i = 0; i < p.thrusters.length; i++) {
      const th = p.thrusters[i];
      let target =
        th.kind === 'rear' ? Math.max(boost, auto * 0.8, fly * 0.12)
        : th.kind === 'side' ? Math.max(boost * 0.8, auto * 0.6, fly * 0.1, rcs * 0.8)
        : Math.max(fly, boost * 0.2, this.launchFlash, rcs * 0.6);
      if (c.fallen) target = 0;
      const k = target > this.thrust[i] ? 14 : 5; // valve opens fast, gas bleeds off slower
      this.thrust[i] += (target - this.thrust[i]) * dampK(k, dt);
      const it = this.thrust[i];
      const on = it > 0.02;
      th.plume.visible = on;
      if (!on) continue;
      // jet direction & vent height in the car's road-aligned frame (after the flip rotation)
      jd.copy(th.dir).applyQuaternion(qTrick);
      vp.copy(th.pos).sub(PIVOT).applyQuaternion(qTrick).add(PIVOT);
      const down = -jd.y;
      const ventH = h + vp.y;
      let len: number, width: number;
      if (th.kind === 'lift' && down > 0.3 && ventH < 24) {
        // stretch to the road like the real thing, widening as it goes
        len = ventH / down + 0.6;
        width = clamp(0.5 + len * 0.1, 0.55, 2.2);
        liftSum += it;
        // vapour spreading across the road where the column lands
        let emit = cloudRate * it;
        while (emit > 0) {
          if (Math.random() < emit) {
            tmp2.copy(vp).addScaledVector(jd, ventH / down).applyMatrix4(m4);
            const a = Math.random() * Math.PI * 2;
            const out = 4 + Math.random() * 7;
            const ox = Math.cos(a) * vX.x + Math.sin(a) * vF.x, oz = Math.cos(a) * vX.z + Math.sin(a) * vF.z;
            const g = 0.82 + Math.random() * 0.1;
            smoke.emit(tmp2.x, tmp2.y + 0.3, tmp2.z,
              this.vel.x * 0.35 + ox * out, 0.6 + Math.random() * 1.6, this.vel.z * 0.35 + oz * out,
              1.1 + Math.random() * 0.9, 1.6 + width, 4.5, g * 0.92, g * 0.97, g * 1.05, 0.3 * it, 1.5, -0.35);
          }
          emit -= 1;
        }
      } else {
        len = th.length * (0.75 + 0.25 * it);
        width = th.width;
      }
      len *= 0.94 + 0.06 * Math.sin(this.time * 23 + i * 1.9);
      th.plume.scale.set(width, len, width);
      const u = th.mat.uniforms;
      u.uIntensity.value = it;
      u.uTime.value = this.time;
      u.uLen.value = len;
      // a few vapour puffs riding the jet give it volume
      if (this.isPlayer && !IS_TOUCH && Math.random() < 0.35 * it) {
        const along = Math.random() * Math.min(len, 6);
        tmp2.copy(vp).addScaledVector(jd, along).applyMatrix4(m4);
        const wd = tmp.copy(jd).transformDirection(m4);
        const sp3 = 6 + Math.random() * 6;
        smoke.emit(tmp2.x, tmp2.y, tmp2.z,
          this.vel.x + wd.x * sp3, this.vel.y + wd.y * sp3, this.vel.z + wd.z * sp3,
          0.35 + Math.random() * 0.3, 0.5 + along * 0.12, 2.6, 0.85, 0.92, 1.0, 0.18 * it, 2.5, 0);
      }
    }
    if (this.liftLight) this.liftLight.intensity = liftSum * 7 * clamp(1 - h / 26, 0, 1);
    if (this.boostLight) this.boostLight.intensity = (this.thrust[1] + this.thrust[2]) * 2.5;

    // shadow stays on the road
    p.shadow.position.y = -h + 0.04;
    const sc = clamp(1 - h * 0.08, 0.3, 1);
    p.shadow.scale.set(sc, 1, sc);
    (p.shadow.material as THREE.MeshBasicMaterial).opacity = c.fallen || this.realShadows ? 0 : 0.85 * sc;

    // respawn blink
    p.root.visible = !(c.ghost > 0 && Math.floor(c.ghost * 10) % 2 === 0) && !(c.fallen && c.respawnTimer < 0.7);

    // ---- particles ----
    if (c.smoke > 0.05 && c.grounded) {
      const n = this.isPlayer ? 2 : 1;
      for (let k = 0; k < n; k++) {
        for (const sx of [-0.9, 0.9]) {
          if (Math.random() > c.smoke) continue;
          tmp2.copy(this.pos).addScaledVector(vX, sx).addScaledVector(vF, -1.45).addScaledVector(vU, 0.2);
          const g = 0.9 + Math.random() * 0.2;
          const tint = this.smokeTint;
          smoke.emit(tmp2.x, tmp2.y, tmp2.z,
            this.vel.x * 0.25 + (Math.random() - 0.5) * 2, this.vel.y * 0.25 + 1.2 + Math.random(), this.vel.z * 0.25 + (Math.random() - 0.5) * 2,
            1.1 + Math.random() * 0.6, 1.2, 3.2, tint[0] * g, tint[1] * g, tint[2] * g, 0.32 * c.smoke, 1.6, -0.6);
        }
      }
    }
    if (c.wallHit > 0 || c.scraping > 3) {
      const n = c.wallHit > 0 ? Math.min(40, 6 + c.wallHit * 4) : 2;
      const side = c.wallSide; // +1 right wall
      for (let k = 0; k < n; k++) {
        tmp2.copy(this.pos).addScaledVector(this.right, side * 1.0).addScaledVector(vF, (Math.random() - 0.3) * 2).addScaledVector(vU, 0.4);
        const sp2 = 4 + Math.random() * 10;
        sparks.emit(tmp2.x, tmp2.y, tmp2.z,
          this.vel.x * 0.7 - this.right.x * side * sp2 * 0.4 + vU.x * sp2 * 0.6 + (Math.random() - 0.5) * 6,
          this.vel.y * 0.7 + vU.y * sp2 * 0.8 + Math.random() * 3,
          this.vel.z * 0.7 - this.right.z * side * sp2 * 0.4 + vU.z * sp2 * 0.6 + (Math.random() - 0.5) * 6,
          0.35 + Math.random() * 0.4, 0.16, -0.1, 4, 2.4, 0.9, 1, 0.6, 14);
      }
    }
    if (c.landed > 5) {
      for (let k = 0; k < 24; k++) {
        tmp2.copy(this.pos).addScaledVector(vF, (Math.random() - 0.5) * 4);
        sparks.emit(tmp2.x, tmp2.y + 0.1, tmp2.z, this.vel.x * 0.6 + (Math.random() - 0.5) * 10, Math.random() * 4, this.vel.z * 0.6 + (Math.random() - 0.5) * 10,
          0.4, 0.15, 0, 4, 2.2, 0.8, 1, 0.8, 12);
      }
    }
  }
}
