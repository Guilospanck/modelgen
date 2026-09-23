// modelgen: procedural low-poly-to-sculpted 3D models from code.
// Subpath modules are importable directly too (@guilospanck/modelgen/lib, ...).
"use strict";
module.exports = {
  lib: require("./lib"),
  sdf: require("./sdf"),
  anatomy: require("./anatomy"),
  overlay: require("./overlay_lib"),
  anchors: require("./anchors"),
  render: require("./render"),
  gltf: require("./gltf"),
  build: require("./build"),
  life: {
    dsl: require("./life/dsl"),
    clips: require("./life/clips"),
    rigs: require("./life/rigs"),
  },
};
