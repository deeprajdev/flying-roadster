import * as THREE from 'three';
import { clamp, dampK } from './core/math';
import type { CarView } from './vehicle/CarView';
import { fovForAspect } from './device';
import type { CarState } from './vehicle/CarPhysics';

export const CAMERA_MODES = ['CHASE', 'FAR CHASE', 'BUMPER'] as const;

const qTarget = new THREE.Quaternion();
const m = new THREE.Matrix4();
const fwdBlend = new THREE.Vector3();
const vX = new THREE.Vector3();
const off = new THREE.Vector3();
const look = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Third-person chase camera. Position is rigidly attached to the car through a *smoothed*
 * orientation (so there is no positional lag at 300 km/h), and the view follows the travel
 * direction slightly during drifts. Rolls with the road, so the Skywall loop just works.
 */
export class ChaseCamera {
  mode = 0;
  readonly cam: THREE.PerspectiveCamera;
  private q = new THREE.Quaternion();
  private initialised = false;
  private shake = 0;
  private fov = 68;
  private boostFx = 0;
  intro = 0; // seconds of intro orbit remaining

  constructor(cam: THREE.PerspectiveCamera) {
    this.cam = cam;
  }

  kick(amount: number) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.initialised = false;
  }

  reset() {
    this.initialised = false;
  }

  update(v: CarView, c: CarState, dt: number) {
    const speed = Math.max(0, c.vx);
    // follow the direction of travel a little when sliding
    fwdBlend.copy(v.fwd);
    if (speed > 5 && this.mode !== 2) {
      const velDir = off.copy(v.vel);
      const along = velDir.dot(v.up);
      velDir.addScaledVector(v.up, -along);
      if (velDir.lengthSq() > 4) fwdBlend.lerp(velDir.normalize(), clamp(Math.abs(c.slip) * 1.2, 0, 0.45)).normalize();
    }
    vX.crossVectors(v.up, fwdBlend).normalize();
    m.makeBasis(vX, v.up, fwdBlend);
    qTarget.setFromRotationMatrix(m);
    if (!this.initialised) {
      this.q.copy(qTarget);
      this.initialised = true;
    } else {
      this.q.slerp(qTarget, dampK(this.mode === 2 ? 30 : c.grounded ? 7 : 3.5, dt));
    }

    const boostT = c.boosting || c.autoThrust ? 1 : 0;
    this.boostFx += (boostT - this.boostFx) * dampK(boostT ? 4 : 2, dt);
    let dist: number, height: number, lookUp: number, lookAhead: number, baseFov: number;
    if (this.mode === 0) { dist = 6.6; height = 2.25; lookUp = 1.15; lookAhead = 5; baseFov = 66; }
    else if (this.mode === 1) { dist = 10.5; height = 3.6; lookUp = 1.3; lookAhead = 6; baseFov = 62; }
    else { dist = -1.2; height = 0.95; lookUp = 0.85; lookAhead = 30; baseFov = 74; }
    if (this.mode !== 2) dist += speed * 0.018 + this.boostFx * 1.2 + (c.grounded ? 0 : Math.min(3, c.h * 0.22));

    // intro orbit during countdown
    let orbit = 0;
    if (this.intro > 0) {
      this.intro = Math.max(0, this.intro - dt);
      const t = this.intro / 3.6;
      orbit = t * t * (3 - 2 * t) * 2.6;
      dist += t * 3;
      height += t * 1.5;
    }
    off.set(0, height, -dist).applyAxisAngle(Y, orbit).applyQuaternion(this.q);
    this.cam.position.copy(v.pos).add(off);
    look.set(0, lookUp, lookAhead).applyQuaternion(this.q).add(v.pos);
    const w = clamp(orbit / 0.8, 0, 1);
    if (w > 0) look.lerp(fwdBlend.copy(v.pos).addScaledVector(v.up, 0.8), w);

    // shake
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.35 + this.boostFx * 0.03 + (speed > 60 ? (speed - 60) * 0.0012 : 0);
    if (sh > 0) {
      this.cam.position.x += (Math.random() - 0.5) * sh;
      this.cam.position.y += (Math.random() - 0.5) * sh;
      this.cam.position.z += (Math.random() - 0.5) * sh;
    }
    this.cam.up.set(0, 1, 0).applyQuaternion(this.q);
    this.cam.lookAt(look);

    const targetFov = fovForAspect(baseFov + clamp(speed - 20, 0, 70) * 0.13 + this.boostFx * 9, this.cam.aspect);
    this.fov += (targetFov - this.fov) * dampK(4, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
