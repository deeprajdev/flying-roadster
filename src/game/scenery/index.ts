import type * as THREE from 'three';
import type { TrackData } from '../track/TrackData';
import type { Theme } from '../track/themes';
import type { TrackId } from '../track/types';
import { buildCoastal } from './coastal';
import { buildDesert } from './desert';
import { buildNeonCity } from './neonCity';

export interface Scenery {
  group: THREE.Group;
  update(t: number, cam: THREE.Vector3): void;
  groundAt(x: number, z: number): number;
}

export function buildScenery(id: TrackId, tr: TrackData, theme: Theme, envMap: THREE.Texture | null): Scenery {
  switch (id) {
    case 'desert':
      return buildDesert(tr, theme);
    case 'coastal':
      return buildCoastal(tr, theme);
    default:
      return buildNeonCity(tr, theme, envMap);
  }
}
