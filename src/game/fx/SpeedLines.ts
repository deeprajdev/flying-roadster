import * as THREE from 'three';

/** Camera-attached radial speed streaks, intensity driven by speed and boost. */
export function makeSpeedLines() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uAspect: { value: 1 }, uColor: { value: new THREE.Color(0.75, 0.9, 1.0) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAmount; uniform float uAspect; uniform vec3 uColor;
      varying vec2 vUv;
      float h(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float r = length(p);
        float a = atan(p.y, p.x);
        float k = floor(a * 70.0);
        float rnd = h(k);
        float speed = 1.2 + rnd * 1.8;
        float band = fract(r * 1.6 - uTime * speed + rnd * 7.0);
        float streak = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.4, band));
        float lane = step(0.72, rnd);
        float mask = smoothstep(0.28, 0.75, r);
        float v = streak * lane * mask * uAmount;
        gl_FragColor = vec4(uColor * v * 0.7, v);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100;
  return { mesh, mat };
}
