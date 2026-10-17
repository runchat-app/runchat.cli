// Plant species as low-poly unit models (1 m tall, standing on the origin),
// each in a few variants. Instances scale them to height and turn them.
import { blob, cylinder, finish, part, rng, shade } from "./geom.js";

export const VARIANTS = 3;

export const SPECIES = {
  oak: {
    label: "Oak",
    height: [8, 16],
    spread: 0.7,
    foliage: "#4f7a3a",
    bark: "#5b4532",
  },
  pine: {
    label: "Scots pine",
    height: [10, 20],
    spread: 0.35,
    foliage: "#2f5a3a",
    bark: "#6b4b33",
  },
  birch: {
    label: "Silver birch",
    height: [7, 14],
    spread: 0.4,
    foliage: "#8fae5a",
    bark: "#e6e1d6",
  },
  cypress: {
    label: "Italian cypress",
    height: [6, 14],
    spread: 0.2,
    foliage: "#3d5e3a",
    bark: "#5a4636",
  },
  shrub: {
    label: "Shrub",
    height: [0.8, 2],
    spread: 1.1,
    foliage: "#5d7d45",
    bark: null,
  },
  grass: {
    label: "Ornamental grass",
    height: [0.5, 1.2],
    spread: 0.8,
    foliage: "#a8a35f",
    bark: null,
  },
};

/** Unit model parts for one species variant: trunk and foliage. */
export function unitModel(species, variant) {
  const s = SPECIES[species];
  const rand = rng(variant * 7919 + species.length * 104729);
  const trunk = part();
  const leaves = part();
  const tone = () => shade(s.foliage, (rand() - 0.5) * 0.25);
  if (species === "oak") {
    cylinder(trunk, { x: 0, y: 0, z0: 0, h: 0.45, r0: 0.045, r1: 0.03 });
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2;
      const d = 0.1 + rand() * 0.12;
      blob(leaves, {
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        z: 0.55 + rand() * 0.2,
        rx: 0.2 + rand() * 0.08,
        rz: 0.17,
        color: tone(),
        rand,
      });
    }
  } else if (species === "pine") {
    cylinder(trunk, { x: 0, y: 0, z0: 0, h: 0.7, r0: 0.03, r1: 0.018 });
    for (let i = 0; i < 3; i++) {
      blob(leaves, {
        x: (rand() - 0.5) * 0.06,
        y: (rand() - 0.5) * 0.06,
        z: 0.62 + i * 0.12,
        rx: 0.16 - i * 0.03,
        rz: 0.08,
        color: tone(),
        rand,
        lump: 0.3,
      });
    }
  } else if (species === "birch") {
    cylinder(trunk, { x: 0, y: 0, z0: 0, h: 0.75, r0: 0.022, r1: 0.012 });
    blob(leaves, {
      x: 0,
      y: 0,
      z: 0.62,
      rx: 0.17,
      rz: 0.3,
      color: tone(),
      rand,
      lump: 0.25,
    });
  } else if (species === "cypress") {
    cylinder(trunk, { x: 0, y: 0, z0: 0, h: 0.15, r0: 0.03 });
    blob(leaves, {
      x: 0,
      y: 0,
      z: 0.55,
      rx: 0.1,
      rz: 0.46,
      color: tone(),
      rand,
      lump: 0.12,
    });
  } else if (species === "shrub") {
    for (let i = 0; i < 3; i++) {
      blob(leaves, {
        x: (rand() - 0.5) * 0.5,
        y: (rand() - 0.5) * 0.5,
        z: 0.35,
        rx: 0.4,
        rz: 0.35,
        color: tone(),
        rand,
        lump: 0.25,
      });
    }
  } else {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      cylinder(leaves, {
        x: Math.cos(a) * 0.08,
        y: Math.sin(a) * 0.08,
        z0: 0,
        h: 0.9 + rand() * 0.2,
        r0: 0.06,
        r1: 0,
        sides: 3,
        color: tone(),
        twist: rand(),
      });
    }
  }
  const parts = [];
  if (trunk.faces.length)
    parts.push({
      ...finish(trunk),
      material: { color: s.bark, roughness: 0.95 },
    });
  parts.push({ ...finish(leaves), material: { roughness: 0.9 } });
  return parts;
}
