// A script part: build(params, kit) returns { parts, textures } made with the
// engine kit. Use one when a shape can't be described with the model's shapes.
module.exports = function build(params, kit) {
  const { lib, sdf } = kit;
  const rand = lib.rng(params.seed ?? 1);
  const shapes = [sdf.ellipsoid([0, 0.12, 0], [0.3, 0.12, 0.22])];
  const n = params.bumps ?? 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    shapes.push(sdf.sphere([Math.cos(a) * 0.18, 0.12 + (rand() - 0.5) * 0.06, Math.sin(a) * 0.12], 0.08 + rand() * 0.04));
  }
  const mesh = sdf.meshField(shapes, { res: 48, kBlend: 0.08, noiseAmp: 0.004 });
  return {
    parts: [lib.part(mesh, "#8d8a84", { tex: "stone", rough: 0.9 })],
    textures: { stone: { base: "#8d8a84", pattern: "mottle", patternColor: "#6f6b64", freq: 2, seed: 9 } },
  };
};
