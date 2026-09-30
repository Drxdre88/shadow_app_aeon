import * as THREE from 'three'
import { SUN_DIR } from '../scene/params'

// Instanced ports of the Planet orb/shell shaders. Colour comes from the
// per-instance `instanceColor` (tint) and `aAccent` (rim accent) attributes
// instead of per-material uniforms, so every memory shares one material and
// one draw call. Fragment maths is unchanged from scene/Planet.tsx.

const ORB_VERTEX = /* glsl */ `
  attribute vec3 aAccent;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vColor;
  varying vec3 vAccent;
  void main() {
    mat4 im = mat4(1.0);
    #ifdef USE_INSTANCING
      im = instanceMatrix;
    #endif
    vec4 viewPos = modelViewMatrix * im * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * mat3(im) * normal);
    vViewDir = normalize(-viewPos.xyz);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    vAccent = aAccent;
    gl_Position = projectionMatrix * viewPos;
  }
`

const ORB_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vColor;
  varying vec3 vAccent;
  uniform vec3 uSunDirView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    vec3 col = mix(vAccent, vColor, pow(facing, 1.4));
    col += vColor * pow(facing, 5.0) * 1.8;
    float sun = clamp(dot(n, normalize(uSunDirView)) * 0.5 + 0.5, 0.0, 1.0);
    col *= 0.42 + sun * 0.62;
    float rim = pow(1.0 - facing, 2.6);
    col += vColor * rim * 1.1;
    gl_FragColor = vec4(col, 1.0);
  }
`

const SHELL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vColor;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float facing = clamp(dot(n, -v), 0.0, 1.0);
    float fres = pow(facing, 1.8);
    // Shell tint = orb tint lerped 30% toward white (was a per-planet uniform).
    vec3 shell = mix(vColor, vec3(1.0), 0.30);
    gl_FragColor = vec4(shell * fres * 1.6, fres * 0.85);
  }
`

export function createOrbMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSunDirView: { value: SUN_DIR.clone() } },
    vertexShader: ORB_VERTEX,
    fragmentShader: ORB_FRAG,
  })
}

export function createShellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ORB_VERTEX,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  })
}

/**
 * Ring debris for pinned memories: the old per-planet 600-rock InstancedMesh,
 * merged into one batch. The orbit runs on the GPU (uTime) instead of 600 CPU
 * matrix writes per ring per frame; the instance matrix only carries the
 * planet position / scale / ring tilt.
 */
export function createRingMaterial(time: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#a89880', roughness: 0.95, metalness: 0.05, flatShading: true })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader =
      'uniform float uTime;\nattribute vec4 aOrbit;\nattribute float aPScale;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `float kAng = aOrbit.x + aOrbit.w * uTime;
         vec3 transformed = position * aPScale + vec3(cos(kAng) * aOrbit.y, aOrbit.z, sin(kAng) * aOrbit.y);`,
      )
  }
  mat.customProgramCacheKey = () => 'kairos-galaxy-ring'
  return mat
}

// Old ring mesh carried rotation={[0.4, 0, 0.15]} inside the planet group.
export const RING_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0.15))
