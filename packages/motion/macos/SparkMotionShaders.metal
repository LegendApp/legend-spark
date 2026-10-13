// Spark motion's built-in Metal shaders (docs/motion.md#shader-effects-and-particles). Spark runs no user-supplied shader
// source. This file is compiled ahead of time into SparkMotionShaders.metallib.h by `bun run motion:shaders`; the header
// records this file's SHA-256, and tests/motion-shaders.test.ts fails when the two disagree.
#include <metal_stdlib>
using namespace metal;

struct SparkDissolveVertex {
  float4 position [[position]];
  float2 point;  // view points from the top-left corner
};

struct SparkDissolveUniforms {
  float2 size;      // the view's size in points
  float threshold;  // dissolveProgress: 0 shows everything, 1 hides everything
  float softness;   // the width of the dissolving edge, in noise units (0-1)
  float cell;       // the noise cell size in points
};

// One triangle that covers the drawable; no vertex buffer.
vertex SparkDissolveVertex sparkDissolveVertex(uint id [[vertex_id]], constant SparkDissolveUniforms &uniforms [[buffer(0)]])
{
  const float2 corner = float2((id << 1) & 2, id & 2);
  SparkDissolveVertex out;
  out.position = float4(corner * 2 - 1, 0, 1);
  out.point = float2(corner.x, 1 - corner.y) * uniforms.size;
  return out;
}

static float sparkHash(float2 cell)
{
  float3 p = fract(float3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Value noise in 0-1: smooth between hashed lattice values.
static float sparkNoise(float2 point)
{
  const float2 cell = floor(point), f = fract(point), u = f * f * (3 - 2 * f);
  return mix(mix(sparkHash(cell), sparkHash(cell + float2(1, 0)), u.x), mix(sparkHash(cell + float2(0, 1)), sparkHash(cell + float2(1, 1)), u.x), u.y);
}

// The mask's alpha: a pixel shows while its noise is above the threshold, with a soft edge.
fragment half4 sparkDissolveFragment(SparkDissolveVertex in [[stage_in]], constant SparkDissolveUniforms &uniforms [[buffer(0)]])
{
  const float2 point = in.point / uniforms.cell;
  const float noise = 0.65 * sparkNoise(point) + 0.35 * sparkNoise(point * 2.03 + 17.0);
  const float edge = uniforms.threshold * (1 + uniforms.softness) - uniforms.softness;
  return half4(smoothstep(edge, edge + uniforms.softness, noise));
}
