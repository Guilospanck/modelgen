"use strict";
// Behaviour programs per body plan, parameterised by the model's rig. Each
// returns a DSL program (see dsl.js) that plays a 16-second cycle.
const PI = 3.14159;
const win = (name, a, b, e = 0.4) => ({ let: name, expr: `smoothstep(${a}, ${a + e}, cyc) * (1 - smoothstep(${b - e}, ${b}, cyc))` });
const arc = (a, b) => `sin(${PI} * clamp((cyc - ${a}) / ${b - a}, 0, 1))`; // 0→1→0 over [a,b]
const f = v => +v.toFixed(4);
const v3 = v => v.map(f);

function commonMasks(R) {
  const P = [];
  if (R.head) P.push({ mask: "w_head", ellipsoid: { c: v3(R.head.c), r: v3(R.head.r), soft: [0.7, 1.35] } });
  else P.push({ mask: "w_head", expr: "0" });
  if (R.tail) P.push({ mask: "w_tail", halfspace: { o: v3(R.tail.root), d: v3(R.tail.dir), ramp: [0, 0.45] } });
  else P.push({ mask: "w_tail", expr: "0" });
  P.push({ mask: "w_tail", expr: "w_tail * (1 - w_head)" });
  if (R.jaw) {
    const h = R.jaw.hinge;
    P.push({ mask: "w_jaw", expr: `w_head * (1 - smoothstep(${f(h[1] - 0.03)}, ${f(h[1] + 0.1)}, p0.y)) * smoothstep(${f(h[2] - 0.08)}, ${f(h[2] + 0.04)}, p0.z)` });
  }
  const legNames = [];
  for (const L of R.legs || []) {
    const nm = `w_leg${L.sx > 0 ? "R" : "L"}${L.sz > 0 ? "F" : L.sz < 0 ? "B" : ""}`;
    legNames.push(nm);
    const side = `smoothstep(-0.03, 0.05, ${L.sx > 0 ? "" : "-"}p0.x)`;
    const fb = L.sz === 0 ? "1" : `smoothstep(-0.1, 0.1, ${L.sz > 0 ? "" : "-"}(p0.z - ${f(L.zc)}))`;
    P.push({ mask: nm, expr: `(1 - smoothstep(${f(R.hipY - 0.1)}, ${f(R.hipY + 0.1)}, p0.y)) * ${side} * ${fb} * (1 - w_head) * (1 - w_tail)` });
  }
  P.push({ mask: "w_legs", expr: legNames.length ? legNames.join(" + ") : "0" });
  if (R.wings) {
    P.push({ mask: "w_wing", expr: `smoothstep(${f(R.wings.rootX - 0.04)}, ${f(R.wings.rootX + 0.14)}, abs(p0.x))` });
    P.push({ let: "sx", expr: "p0.x < 0 ? -1 : 1" });
  } else P.push({ mask: "w_wing", expr: "0" });
  if (R.fins) {
    P.push({ mask: "w_fin", ellipsoid: { c: v3(R.fins.c), r: v3(R.fins.r), soft: [0.6, 1.3] } });
    P.push({ let: "sx", expr: "p0.x < 0 ? -1 : 1" });
  } else P.push({ mask: "w_fin", expr: "0" });
  P.push({ mask: "w_torso", expr: "clamp(1 - w_head - w_tail - w_legs - w_wing - w_fin, 0, 1)" });
  return { P, legNames };
}

const neckOf = R => v3(R.neck || (R.head ? R.head.c : R.ctr));
const ctrOf = R => v3(R.ctr);

function headIdle(P, R, calm = "1") {
  if (!R.head) return;
  P.push({ let: "ph", expr: "fract(t / 6)" });
  P.push({ let: "perk", expr: "smoothstep(0, 0.08, ph) * (1 - smoothstep(0.08, 0.16, ph))" });
  P.push({ rot: "y", angle: `(${calm}) * (0.15 * sin(t * 0.5) + 0.04 * sin(t * 2.3))`, pivot: neckOf(R), weight: "w_head" });
  P.push({ rot: "x", angle: `(${calm}) * (0.05 * sin(t * 0.9) + 0.12 * perk)`, pivot: neckOf(R), weight: "w_head" });
}
function breathe(P, R, amt = 0.03, rate = 1.5) {
  P.push({ squash: [`1 + ${amt} * sin(t * ${rate})`, `1 + ${amt} * sin(t * ${rate})`, "1"], pivot: ctrOf(R), weight: "w_torso" });
}
function tailSway(P, R, axis, amp, rate) {
  if (!R.tail) return;
  P.push({ rot: axis, angle: `${amp} * sin(t * ${rate})`, pivot: v3(R.tail.root), weight: "w_tail" });
}
function jawOpen(P, R, amount) {
  if (!R.jaw) return;
  P.push({ rot: "x", angle: amount, pivot: v3(R.jaw.hinge), weight: "w_jaw" });
}
function legSwing(P, R, legNames, amp, rate, weight) {
  R.legs.forEach((L, i) => {
    const phase = L.sx * L.sz > 0 ? 0 : PI; // diagonal pairs
    P.push({ rot: "x", angle: `${amp} * sin(t * ${rate} + ${phase})`, pivot: v3(L.hip), weight: `${legNames[i]} * (${weight})` });
  });
}

// ---------------- plans ----------------

function quad(R) {
  const S = R.params;
  const { P, legNames } = commonMasks(R);
  P.push(win("wWalk", 4, 9.5, 0.6), win("wSig", 11, 13.5, 0.3), win("wBite", 14.2, 14.7, 0.1));
  P.push({ let: "calm", expr: "1 - max(wWalk, max(wSig, wBite))" });
  breathe(P, R);
  headIdle(P, R, "calm");
  if (S.sinuous) P.push({ move: ["0.03 * sin(t * 3 + p0.z * 3)", "0", "0"], weight: "w_torso + w_tail" });
  tailSway(P, R, "y", 0.3, S.sinuous ? 2.5 : 3.2);
  if (S.gait > 0 && R.legs?.length) {
    legSwing(P, R, legNames, S.stride, S.gait, "wWalk");
    P.push({ move: ["0", `0.02 * abs(sin(t * ${S.gait}))`, "0"], weight: "wWalk" });
    P.push({ rot: "x", angle: `0.05 * sin(t * ${S.gait})`, pivot: neckOf(R), weight: "w_head * wWalk" });
    if (S.prance) P.push({ rot: "x", angle: `-0.12 * max(0, sin(t * ${S.gait / 2}))`, pivot: ctrOf(R), weight: "wWalk" });
  }
  switch (S.signature) {
    case "neigh":
      P.push({ rot: "x", angle: "-0.5 * wSig * (0.5 + 0.5 * sin(t * 6))", pivot: neckOf(R), weight: "w_head" });
      R.legs?.filter(L => L.sz > 0).forEach((L, i) => P.push({ rot: "x", angle: `-0.7 * wSig * max(0, sin(t * 4 + ${i * PI}))`, pivot: v3(L.hip), weight: legNames[R.legs.indexOf(L)] }));
      P.push({ move: ["0", "0.03 * wSig * max(0, sin(t * 4))", "0"], weight: "1 - w_legs" });
      break;
    case "howl":
      P.push({ rot: "x", angle: "-0.8 * wSig", pivot: neckOf(R), weight: "w_head" });
      jawOpen(P, R, "0.45 * wSig");
      P.push({ move: ["0.006 * sin(t * 40) * wSig", "0", "0"] });
      tailSway(P, R, "x", -0.25, 0.0001); // raised
      break;
    case "pounce":
      P.push({ let: "crouch", expr: "smoothstep(11, 12, cyc) * (1 - smoothstep(12, 12.3, cyc))" });
      P.push({ let: "lunge", expr: "smoothstep(12.2, 12.5, cyc) * (1 - smoothstep(13, 13.5, cyc))" });
      P.push({ move: ["0", "-0.12 * crouch + 0.2 * lunge", "0.18 * lunge"], weight: "1 - w_legs" });
      P.push({ rot: "x", angle: "0.25 * crouch - 0.2 * lunge", pivot: neckOf(R), weight: "w_head" });
      R.legs?.forEach((L, i) => P.push({ rot: "x", angle: L.sz > 0 ? "0.8 * lunge" : "-0.6 * lunge", pivot: v3(L.hip), weight: legNames[i] }));
      break;
    case "roll":
      P.push({ rot: "z", angle: `${2 * PI} * smoothstep(11, 13, cyc)`, pivot: ctrOf(R) });
      break;
    case "hop":
      P.push({ let: "hop", expr: "max(0, sin(t * 4.5)) * wWalk" });
      P.push({ move: ["0", "0.14 * hop", "0"] });
      P.push({ rot: "x", angle: "-0.22 * hop", pivot: ctrOf(R) });
      R.legs?.filter(L => L.sz < 0).forEach(L => P.push({ rot: "x", angle: "0.5 * hop", pivot: v3(L.hip), weight: legNames[R.legs.indexOf(L)] }));
      P.push({ rot: "x", angle: "-0.35 * wSig * max(0, sin(t * 5))", pivot: neckOf(R), weight: "w_head" }); // ear-twitchy head bob
      break;
  }
  if (S.bite && R.jaw) {
    P.push({ move: ["0", "0", "0.08 * wBite"], weight: "w_head" });
    jawOpen(P, R, "0.5 * wBite");
  }
  P.push({ rot: "z", angle: "0.015 * sin(t * 0.7)", pivot: ctrOf(R) });
  return P;
}

function wingedQuad(R) {
  const S = R.params;
  const { P, legNames } = commonMasks(R);
  P.push(win("wWalk", 3, 7, 0.6), win("wFly", 8, 11.5, 0.6), win("wSig", 12.5, 14.5, 0.3), win("wBite", 15, 15.5, 0.1));
  P.push({ let: "calm", expr: "1 - max(wWalk, max(wFly, max(wSig, wBite)))" });
  breathe(P, R);
  headIdle(P, R, "calm");
  tailSway(P, R, "y", 0.3, 2.6);
  const W = R.wings, piv = sx => [`${sx} * ${f(W.rootX)}`, f(W.rootY), f(W.rootZ)];
  // Wings: at rest a slow settle; in flight a full beat; in the roar they throw open.
  P.push({ let: "flapEnv", expr: "0.25 + 0.75 * wFly" });
  P.push({ rot: "z", angle: `sx * (${S.flapAmp} * sin(t * ${S.flapRate}) * flapEnv + 0.35 * wSig + 0.15 * wFly)`, pivot: ["sx * " + f(W.rootX), f(W.rootY), f(W.rootZ)], weight: "w_wing" });
  P.push({ move: ["0", `0.1 * wFly + 0.02 * sin(t * ${S.flapRate} + 1.5) * wFly`, "0"], weight: "1 - w_wing" });
  if (S.gait > 0 && R.legs?.length) {
    legSwing(P, R, legNames, S.stride, S.gait, "wWalk");
    P.push({ move: ["0", `0.02 * abs(sin(t * ${S.gait}))`, "0"], weight: "wWalk" });
    R.legs.forEach((L, i) => P.push({ rot: "x", angle: L.sz > 0 ? "-0.5 * wFly" : "0.4 * wFly", pivot: v3(L.hip), weight: legNames[i] })); // legs trail in flight
  }
  switch (S.signature) {
    case "roar":
      P.push({ rot: "x", angle: "-0.55 * wSig", pivot: neckOf(R), weight: "w_head" });
      jawOpen(P, R, "0.55 * wSig");
      P.push({ move: ["0.006 * sin(t * 40) * wSig", "0.05 * wSig", "0"], weight: "1 - w_legs" });
      if (R.tail) P.push({ rot: "y", angle: "0.5 * sin(t * 5) * wSig", pivot: v3(R.tail.root), weight: "w_tail" });
      break;
    case "screech":
      P.push({ rot: "x", angle: "-0.5 * wSig * (0.7 + 0.3 * sin(t * 9))", pivot: neckOf(R), weight: "w_head" });
      P.push({ move: ["0", "0.05 * wSig", "0"], weight: "1 - w_legs" });
      break;
    case "neigh":
      P.push({ rot: "x", angle: "-0.5 * wSig * (0.5 + 0.5 * sin(t * 6))", pivot: neckOf(R), weight: "w_head" });
      R.legs?.filter(L => L.sz > 0).forEach((L, i) => P.push({ rot: "x", angle: `-0.7 * wSig * max(0, sin(t * 4 + ${i * PI}))`, pivot: v3(L.hip), weight: legNames[R.legs.indexOf(L)] }));
      break;
  }
  if (S.bite && R.jaw) { P.push({ move: ["0", "0", "0.08 * wBite"], weight: "w_head" }); jawOpen(P, R, "0.5 * wBite"); }
  return P;
}

function flyer(R) {
  const S = R.params;
  const { P } = commonMasks(R);
  P.push(win("wGlide", 5, 9, 0.6), win("wDive", 10.5, 12, 0.3), win("wCry", 13.2, 14.6, 0.25));
  const W = R.wings;
  const glideK = S.glide ? "(1 - 0.9 * wGlide)" : "1";
  const dive = S.dive ? " - 0.9 * wDive" : "";
  const flare = S.flare ? " + 0.5 * wCry" : (S.screech ? " + 0.25 * wCry" : "");
  P.push({ rot: "z", angle: `sx * (${S.flapAmp} * sin(t * ${S.flapRate}) * ${glideK}${dive}${flare})`, pivot: ["sx * " + f(W.rootX), f(W.rootY), f(W.rootZ)], weight: "w_wing" });
  if (!S.hover) P.push({ move: ["0", `0.02 * sin(t * ${S.flapRate} + 1.5)`, "0"], weight: "1 - w_wing" });
  else P.push({ move: ["0.01 * sin(t * 3.1)", "0.02 * sin(t * 2.3)", "0.01 * sin(t * 1.7)"] }); // hover jitter
  if (S.glide) {
    P.push({ rot: "z", angle: `${S.bank} * sin(t * 0.8) * wGlide`, pivot: ctrOf(R) });
    P.push({ rot: "x", angle: "0.08 * wGlide", pivot: ctrOf(R) });
  }
  if (S.dive) {
    P.push({ rot: "x", angle: "0.55 * wDive", pivot: ctrOf(R) });
    P.push({ move: ["0", "-0.15 * wDive", "0.1 * wDive"] });
  }
  headIdle(P, R, "1 - wCry");
  if (S.screech || S.flare) P.push({ rot: "x", angle: "-0.45 * wCry", pivot: neckOf(R), weight: "w_head" });
  if (S.tremor) P.push({ move: ["0.008 * sin(t * 45) * wCry", "0", "0"] });
  if (S.flare) P.push({ squash: ["1 + 0.05 * wCry", "1 + 0.05 * wCry", "1 + 0.05 * wCry"], pivot: ctrOf(R), weight: "w_torso" });
  tailSway(P, R, "x", 0.12, 1.3);
  if (R.tail) P.push({ rot: "x", angle: "0.25 * wGlide + 0.2 * wCry", pivot: v3(R.tail.root), weight: "w_tail" }); // tail fans/lifts
  breathe(P, R, 0.015, 1.6);
  return P;
}

function perched(R) {
  const S = R.params;
  const { P, legNames } = commonMasks(R);
  P.push(win("wRuffle", 5, 6.5, 0.3), win("wCall", 9, 10.5, 0.3), win("wHop", 12, 13.2, 0.2));
  // The head does the talking: a slow scan, a sharp turn now and then, a tilt.
  P.push({ let: "scan", expr: `${S.swivel} * clamp(0.85 * sin(t * 0.45) + 0.35 * sin(t * 1.3), -1, 1)` });
  P.push({ rot: "y", angle: "scan", pivot: neckOf(R), weight: "w_head" });
  P.push({ rot: "z", angle: "0.22 * sin(t * 0.7 + 1)", pivot: neckOf(R), weight: "w_head" });
  P.push({ rot: "x", angle: "0.06 * sin(t * 1.1)", pivot: neckOf(R), weight: "w_head" });
  breathe(P, R, 0.03, 1.4);
  if (S.ruffle) P.push({ squash: ["1 + 0.07 * wRuffle * (0.5 + 0.5 * sin(t * 16))", "1 + 0.03 * wRuffle", "1 + 0.07 * wRuffle * (0.5 + 0.5 * sin(t * 16))"], pivot: ctrOf(R), weight: "w_torso" });
  if (S.hoot) {
    P.push({ rot: "x", angle: "0.22 * wCall * max(0, sin(t * 3))", pivot: neckOf(R), weight: "w_head" });
    P.push({ squash: ["1 + 0.06 * wCall * max(0, sin(t * 3))", "1", "1 + 0.06 * wCall * max(0, sin(t * 3))"], pivot: ctrOf(R), weight: "w_torso" });
  }
  if (S.caw) P.push({ rot: "x", angle: "-0.4 * wCall * max(0, sin(t * 5))", pivot: neckOf(R), weight: "w_head" });
  if (S.hop) {
    P.push({ move: ["0", "0.1 * wHop * max(0, sin(t * 6))", "0"] });
    R.legs?.forEach((L, i) => P.push({ rot: "x", angle: "0.3 * wHop * max(0, sin(t * 6))", pivot: v3(L.hip), weight: legNames[i] }));
  }
  if (S.shuffle) P.push({ squash: ["1 + 0.04 * wHop * (0.5 + 0.5 * sin(t * 12))", "1", "1"], pivot: ctrOf(R), weight: "w_torso" });
  tailSway(P, R, "x", 0.08, 1.1);
  P.push({ rot: "z", angle: "0.02 * sin(t * 0.6)", pivot: [f(R.ctr[0]), f(R.mn[1]), f(R.ctr[2])] });
  return P;
}

function cetacean(R) {
  const S = R.params;
  const { P } = commonMasks(R);
  P.push(win("wBreach", 9.5, 11.5, 0.5), win("wSlap", 13, 14, 0.2), win("wChirp", 5, 6.5, 0.3));
  // Cetaceans flex vertically: flukes beat up and down, a wave runs down the body.
  if (R.tail) P.push({ rot: "x", angle: `0.28 * sin(t * ${S.rate})`, pivot: v3(R.tail.root), weight: "w_tail" });
  P.push({ move: ["0", `0.03 * sin(t * ${S.rate} - p0.z * 2.5)`, "0"], weight: "w_torso" });
  if (R.fins) P.push({ rot: "z", angle: `sx * 0.18 * sin(t * ${S.rate * 1.3})`, pivot: ["sx * 0.12", f(R.fins.c[1]), f(R.fins.c[2])], weight: "w_fin" });
  P.push({ rot: "z", angle: "0.05 * sin(t * 0.6)", pivot: ctrOf(R) });
  if (S.breach) {
    P.push({ move: ["0", `0.4 * ${arc(9.5, 11.5)}`, "0"] });
    P.push({ rot: "x", angle: "-0.6 * wBreach", pivot: ctrOf(R) });
    if (S.spin) P.push({ rot: "z", angle: `${2 * PI} * smoothstep(10, 11.2, cyc)`, pivot: ctrOf(R) });
  }
  if (S.slap && R.tail) P.push({ rot: "x", angle: "-0.6 * wSlap * max(0, sin(t * 6))", pivot: v3(R.tail.root), weight: "w_tail" });
  if (S.chirp) { P.push({ rot: "x", angle: "0.15 * sin(t * 8) * wChirp", pivot: neckOf(R), weight: "w_head" }); jawOpen(P, R, "0.35 * wChirp * (0.5 + 0.5 * sin(t * 8))"); }
  P.push({ rot: "y", angle: "0.06 * sin(t * 0.5)", pivot: neckOf(R), weight: "w_head" });
  return P;
}

function fish(R) {
  const S = R.params;
  const { P } = commonMasks(R);
  P.push(win("wDart", 5, 7, 0.3), win("wSail", 9, 12, 0.6), win("wLeap", 13, 14.5, 0.3));
  P.push({ let: "rate", expr: `${S.rate} + 3 * wDart` });
  if (R.tail) P.push({ rot: "y", angle: "(0.3 + 0.15 * wDart) * sin(t * rate)", pivot: v3(R.tail.root), weight: "w_tail" });
  P.push({ move: ["0.03 * sin(t * rate - p0.z * 3)", "0", "0"], weight: "w_torso" });
  if (R.fins) P.push({ rot: "y", angle: "sx * 0.2 * sin(t * rate * 1.2)", pivot: ["sx * 0.08", f(R.fins.c[1]), f(R.fins.c[2])], weight: "w_fin" });
  P.push({ move: ["0", "0", "0.15 * wDart"] });
  if (S.sail) {
    const top = R.ctr[1] + 0.12;
    P.push({ mask: "w_sail", expr: `smoothstep(${f(top)}, ${f(top + 0.25)}, p0.y) * (1 - w_head) * (1 - w_tail)` });
    P.push({ squash: ["1", "1 + 0.35 * wSail", "1"], pivot: [f(R.ctr[0]), f(top), f(R.ctr[2])], weight: "w_sail" });
  }
  P.push({ move: ["0", `0.35 * ${arc(13, 14.5)}`, "0"] });
  P.push({ rot: "x", angle: "-0.5 * wLeap", pivot: ctrOf(R) });
  P.push({ rot: "z", angle: "0.04 * sin(t * 0.7)", pivot: ctrOf(R) });
  return P;
}

function seahorse(R) {
  const { P } = commonMasks(R);
  P.push(win("wToss", 5, 7, 0.3), win("wCurl", 9.5, 12.5, 0.6));
  headIdle(P, R, "1 - wToss");
  P.push({ rot: "x", angle: "-0.45 * wToss * (0.5 + 0.5 * sin(t * 6))", pivot: neckOf(R), weight: "w_head" });
  if (R.tail) {
    P.push({ rot: "x", angle: "0.25 * sin(t * 1.8) + 0.5 * wCurl", pivot: v3(R.tail.root), weight: "w_tail" });
    P.push({ rot: "y", angle: "0.12 * sin(t * 2.2)", pivot: v3(R.tail.root), weight: "w_tail" });
  }
  if (R.fins) P.push({ rot: "y", angle: "sx * 0.35 * sin(t * 9)", pivot: ["sx * 0.05", f(R.fins.c[1]), f(R.fins.c[2])], weight: "w_fin" });
  P.push({ move: ["0", "0.03 * sin(t * 1.3)", "0"] });
  breathe(P, R, 0.02, 1.4);
  P.push({ rot: "z", angle: "0.05 * sin(t * 0.5)", pivot: ctrOf(R) });
  return P;
}

function seal(R) {
  const { P } = commonMasks(R);
  P.push(win("wWave", 4, 7, 0.5), win("wBark", 9, 10.5, 0.3), win("wCurl", 12, 14, 0.6));
  headIdle(P, R, "1 - wBark");
  P.push({ rot: "x", angle: "-0.45 * wBark", pivot: neckOf(R), weight: "w_head" });
  jawOpen(P, R, "0.4 * wBark * max(0, sin(t * 6))");
  if (R.fins) P.push({ rot: "z", angle: "sx * 0.45 * sin(t * 2.5) * wWave", pivot: ["sx * 0.08", f(R.fins.c[1]), f(R.fins.c[2])], weight: "w_fin" });
  if (R.tail) P.push({ rot: "x", angle: "0.25 * sin(t * 2) + 0.35 * wCurl", pivot: v3(R.tail.root), weight: "w_tail" });
  P.push({ rot: "x", angle: "-0.12 * wCurl", pivot: ctrOf(R) });
  breathe(P, R, 0.03, 1.2);
  P.push({ rot: "z", angle: "0.04 * sin(t * 0.6)", pivot: ctrOf(R) });
  return P;
}

function turtle(R) {
  const { P } = commonMasks(R);
  P.push(win("wHide", 10, 11.5, 0.4));
  const W = R.wings; // fore flippers reach beyond the core like wings
  if (W) {
    P.push({ rot: "z", angle: "sx * 0.35 * sin(t * 1.6)", pivot: ["sx * " + f(W.rootX), f(W.rootY), f(W.rootZ)], weight: "w_wing" });
    P.push({ rot: "y", angle: "sx * 0.15 * sin(t * 1.6 + 1)", pivot: ["sx * " + f(W.rootX), f(W.rootY), f(W.rootZ)], weight: "w_wing" });
  }
  if (R.tail) P.push({ rot: "x", angle: "0.2 * sin(t * 1.6 + 2)", pivot: v3(R.tail.root), weight: "w_tail" });
  P.push({ rot: "x", angle: "0.15 * sin(t * 0.9)", pivot: neckOf(R), weight: "w_head" });
  P.push({ rot: "y", angle: "0.12 * sin(t * 0.4)", pivot: neckOf(R), weight: "w_head" });
  P.push({ move: ["0", "0", "-0.12 * wHide"], weight: "w_head" });
  P.push({ move: ["0", "0.02 * sin(t * 1.6)", "0"] });
  P.push({ rot: "z", angle: "0.04 * sin(t * 0.5)", pivot: ctrOf(R) });
  return P;
}

function serpent(R) {
  const S = R.params;
  const { P } = commonMasks(R);
  P.push(win("wBreach", 5, 7.5, 0.5), win("wRoar", 11, 13, 0.3));
  P.push({ move: ["0", `0.05 * sin(t * ${S.rate} - p0.z * 3.2)`, "0"], weight: "1 - w_head" });
  P.push({ move: [`0.02 * sin(t * ${S.rate * 0.7} - p0.z * 2)`, "0", "0"], weight: "1 - w_head" });
  if (R.tail) P.push({ rot: "x", angle: `0.3 * sin(t * ${S.rate} - 2)`, pivot: v3(R.tail.root), weight: "w_tail" });
  headIdle(P, R, "1 - wRoar");
  P.push({ rot: "x", angle: "-0.5 * wRoar", pivot: neckOf(R), weight: "w_head" });
  jawOpen(P, R, "0.5 * wRoar");
  P.push({ move: ["0.006 * sin(t * 40) * wRoar", "0", "0"] });
  P.push({ move: ["0", `0.3 * ${arc(5, 7.5)}`, "0"] });
  P.push({ rot: "x", angle: "-0.35 * wBreach", pivot: ctrOf(R) });
  return P;
}

function kraken(R) {
  const { P } = commonMasks(R);
  P.push(win("wStrike", 10, 11.2, 0.2), win("wBite", 14, 14.5, 0.1));
  P.push({ mask: "w_tent", expr: "1 - w_head" });
  P.push({ mask: "w_up", expr: `w_tent * smoothstep(${f(R.head.c[1])}, ${f(R.head.c[1] + 0.3)}, p0.y)` });
  P.push({ squash: ["1 + 0.05 * (0.5 + 0.5 * sin(t * 2))", "1 + 0.05 * (0.5 + 0.5 * sin(t * 2))", "1 + 0.05 * (0.5 + 0.5 * sin(t * 2))"], pivot: v3(R.head.c), weight: "w_head" });
  P.push({ move: ["0.09 * sin(t * 2.2 + p0.y * 4 + p0.z * 3)", "0.07 * sin(t * 1.7 + p0.x * 4)", "0.09 * sin(t * 2 + p0.x * 3 + p0.y * 2)"], weight: "w_tent" });
  P.push({ rot: "x", angle: "0.9 * wStrike * max(0, sin(t * 4))", pivot: [f(R.ctr[0]), f(R.head.c[1]), f(R.head.c[2])], weight: "w_up" });
  P.push({ rot: "y", angle: "0.08 * sin(t * 0.7)", pivot: ctrOf(R) });
  P.push({ rot: "x", angle: "0.1 * sin(t * 0.9)", pivot: neckOf(R), weight: "w_head" });
  jawOpen(P, R, "0.4 * wBite");
  P.push({ move: ["0", "0.03 * sin(t * 1.1)", "0"] });
  return P;
}

function biped(R) {
  const { P, legNames } = commonMasks(R);
  P.push(win("wWalk", 4, 8, 0.6), win("wBow", 11, 13, 0.4));
  breathe(P, R, 0.03, 1.4);
  headIdle(P, R, "1 - wBow");
  R.legs?.forEach((L, i) => P.push({ rot: "x", angle: `0.35 * sin(t * 6 + ${L.sx > 0 ? 0 : PI})`, pivot: v3(L.hip), weight: `${legNames[i]} * wWalk` }));
  P.push({ rot: "z", angle: "0.08 * sin(t * 3) * wWalk", pivot: [f(R.ctr[0]), f(R.hipY), f(R.ctr[2])] });
  P.push({ move: ["0", "0.015 * abs(sin(t * 6)) * wWalk", "0"] });
  P.push({ rot: "x", angle: "0.55 * wBow", pivot: [f(R.ctr[0]), f(R.hipY), f(R.ctr[2])], weight: "1 - w_legs" });
  return P;
}

const PLANS = { quad, winged_quad: wingedQuad, flyer, perched, cetacean, fish, seahorse, seal, turtle, serpent, kraken, biped };
function program(R) { return PLANS[R.plan](R); }
module.exports = { program };
