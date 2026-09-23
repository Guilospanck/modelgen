"use strict";
// Minimal builder: a paper lantern. Shows the builder contract — return
// { parts, textures }; forward = +z, up = +y, ground = y 0.
const { tube, uvSphere, place, part } = require("../lib");

module.exports = function build() {
  const parts = [
    part(place(uvSphere(20, 14), { s: [0.5, 0.6, 0.5], t: [0, 0.75, 0] }), "#e8a13a", { tex: "paper", rough: 0.8, emissive: "#6a3a08" }),
    part(tube([[0, 1.3, 0], [0, 1.42, 0]], [0.14, 0.14], 16), "#3a2a1c", { rough: 0.5 }),
    part(tube([[0, 0.1, 0], [0, 0.2, 0]], [0.18, 0.16], 16), "#3a2a1c", { rough: 0.5 }),
    part(tube([[0, 0, 0], [0, 0.12, 0]], [0.04, 0.04], 8), "#2a2a2a", { metal: 0.8, rough: 0.3 }),
  ];
  const textures = { paper: { base: "#e8a13a", pattern: "stripes", patternColor: "#c4761f", freq: 6, seed: 3 } };
  return { parts, textures };
};
