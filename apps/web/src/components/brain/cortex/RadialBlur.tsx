'use client'

import { wrapEffect } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import * as THREE from 'three'

const RADIAL_BLUR_FRAGMENT = `
  uniform float uStrength;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uStrength < 0.0005) { outputColor = inputColor; return; }
    vec2 dir = uv - vec2(0.5);
    vec4 acc = inputColor;
    float totalW = 1.0;
    const int N = 10;
    for (int i = 1; i <= N; i++) {
      float t = (float(i) / float(N)) * uStrength;
      vec2 s = uv - dir * t;
      float w = 1.0 - float(i) / float(N);
      acc += texture2D(inputBuffer, s) * w;
      totalW += w;
    }
    outputColor = acc / totalW;
  }
`

class RadialBlurImpl extends Effect {
  constructor({ strength = 0 }: { strength?: number } = {}) {
    super('RadialBlur', RADIAL_BLUR_FRAGMENT, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uStrength', new THREE.Uniform(strength)],
      ]),
    })
  }
}

export const RadialBlur = wrapEffect(RadialBlurImpl)
