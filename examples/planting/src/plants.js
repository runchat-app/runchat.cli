// Plant species grown as models 1 unit tall standing on the origin: branching
// bark tubes carrying alpha-cut foliage cards, a few variants each. Instances
// scale them to their real height and turn them.
import { card, finish, part, quad, rng, tube, vec } from "./geom.js";
import { foliageCellUV, foliageMaterial, textured } from "./textures.js";

export const VARIANTS = 3;

export const SPECIES = {
  oak: {
    label: "English oak",
    height: [9, 18],
    spread: 0.75,
    bark: "oak_bark",
    foliage: "oak_leaves",
    form: "broadleaf",
  },
  birch: {
    label: "Silver birch",
    height: [8, 15],
    spread: 0.45,
    bark: "birch_bark",
    foliage: "birch_leaves",
    form: "birch",
  },
  pine: {
    label: "Scots pine",
    height: [12, 22],
    spread: 0.4,
    bark: "pine_bark",
    foliage: "needles",
    form: "pine",
  },
  spruce: {
    label: "Norway spruce",
    height: [10, 20],
    spread: 0.35,
    bark: "pine_bark",
    foliage: "needles",
    form: "spruce",
  },
  cypress: {
    label: "Italian cypress",
    height: [7, 14],
    spread: 0.18,
    bark: "pine_bark",
    foliage: "needles",
    form: "cypress",
  },
  shrub: {
    label: "Hazel shrub",
    height: [1.2, 3],
    spread: 1,
    bark: "oak_bark",
    foliage: "shrub_leaves",
    form: "shrub",
  },
  fern: {
    label: "Bracken fern",
    height: [0.6, 1.2],
    spread: 1.2,
    bark: null,
    foliage: "fern",
    form: "fern",
  },
  grass: {
    label: "Meadow grass",
    height: [0.4, 1],
    spread: 0.9,
    bark: null,
    foliage: "grass_blades",
    form: "grass",
  },
};

/** Textures a set of species needs: bark materials and foliage atlases. */
export function speciesTextures(list) {
  const barks = new Set();
  const foliage = new Set();
  for (const sp of list) {
    const s = SPECIES[sp];
    if (s.bark) barks.add(s.bark);
    foliage.add(s.foliage);
  }
  return { barks: [...barks], foliage: [...foliage] };
}

const BARK_TILE = 0.07;

function rotateAround(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = vec.dot(axis, v);
  const cr = vec.cross(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * d * (1 - c),
    v[1] * c + cr[1] * s + axis[1] * d * (1 - c),
    v[2] * c + cr[2] * s + axis[2] * d * (1 - c),
  ];
}

function perpendicular(dir) {
  return vec.norm(
    Math.abs(dir[2]) < 0.9
      ? vec.cross(dir, [0, 0, 1])
      : vec.cross(dir, [1, 0, 0]),
  );
}

function toHex(k, base) {
  const n = parseInt(base.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => f(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Grow a model for a species variant: { parts, crown } in unit height. */
export function unitModel(species, variant) {
  const s = SPECIES[species];
  const rand = rng(
    variant * 7919 + species.length * 104729 + species.charCodeAt(0),
  );
  const bark = part();
  const leaves = part();
  const cards = [];
  const leafAt = (at, dir, size) =>
    cards.push({ at, dir, size, cell: Math.floor(rand() * 4) });

  /** One branch: a curving tapered tube; returns its path. */
  function limb(
    start,
    dir,
    length,
    r0,
    r1,
    { gravity = 0, wander = 0.25, segments = 6, sides = 6 } = {},
  ) {
    const path = [[...start, r0]];
    let d = vec.norm(dir);
    let at = start;
    for (let i = 1; i <= segments; i++) {
      const k = i / segments;
      d = vec.norm([
        d[0] + (rand() - 0.5) * wander,
        d[1] + (rand() - 0.5) * wander,
        d[2] + (rand() - 0.5) * wander * 0.6 - gravity * k,
      ]);
      at = vec.add(at, vec.scale(d, length / segments));
      path.push([...at, r0 + (r1 - r0) * k]);
    }
    tube(bark, path, { sides, tile: BARK_TILE });
    return path;
  }
  const pointOn = (path, t) => {
    const f = t * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    const k = f - i;
    return [0, 1, 2, 3].map(
      (j) => path[i][j] + (path[i + 1][j] - path[i][j]) * k,
    );
  };
  const dirOn = (path, t) => {
    const i = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
    return vec.norm(vec.sub(path[i + 1].slice(0, 3), path[i].slice(0, 3)));
  };

  /** Recursive branching for broadleaf trees and shrubs. */
  function branchOut(path, level, cfg) {
    const length = vec.len(
      vec.sub(path[path.length - 1].slice(0, 3), path[0].slice(0, 3)),
    );
    if (level >= cfg.levels) {
      const n = cfg.leavesPerTwig;
      for (let i = 0; i < n; i++) {
        const p = pointOn(path, 0.35 + rand() * 0.65);
        const dir = vec.norm([rand() - 0.5, rand() - 0.5, rand() - 0.2]);
        leafAt(
          vec.add(p.slice(0, 3), vec.scale(dir, cfg.leafSize * 0.3)),
          dir,
          cfg.leafSize * (0.75 + rand() * 0.5),
        );
      }
      return;
    }
    const count = cfg.children[level];
    const golden = 2.39996;
    let twist = rand() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const t =
        cfg.start[level] +
        (1 - cfg.start[level]) * ((i + rand() * 0.6) / count);
      const p = pointOn(path, t);
      const along = dirOn(path, t);
      twist += golden;
      const side = rotateAround(perpendicular(along), along, twist);
      const angle = (cfg.angle[level] + (rand() - 0.5) * 18) * (Math.PI / 180);
      const dir = vec.norm(
        vec.add(
          vec.scale(along, Math.cos(angle)),
          vec.scale(side, Math.sin(angle)),
        ),
      );
      const envelope = cfg.envelope ? cfg.envelope(p[2], t) : 1;
      const len =
        length *
        cfg.ratio[level] *
        (1.1 - t * 0.45) *
        envelope *
        (0.8 + rand() * 0.4);
      if (len < 0.01) continue;
      const r = Math.max(0.0015, p[3] * 0.62);
      const child = limb(p.slice(0, 3), dir, len, r, r * 0.35, {
        gravity: cfg.gravity[level],
        wander: cfg.wander,
        segments: level === 0 ? 5 : 4,
        sides: level === 0 ? 6 : 4,
      });
      branchOut(child, level + 1, cfg);
    }
  }

  if (s.form === "broadleaf" || s.form === "birch") {
    const birch = s.form === "birch";
    const lean = [(rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12, 1];
    const trunk = limb(
      [0, 0, 0],
      lean,
      birch ? 0.7 : 0.42,
      birch ? 0.022 : 0.04,
      birch ? 0.009 : 0.026,
      { wander: 0.12, segments: 6, sides: 9 },
    );
    const crownZ = birch ? 0.62 : 0.6;
    branchOut(trunk, 0, {
      levels: 3,
      children: birch ? [9, 4, 3] : [7, 4, 3],
      start: birch ? [0.35, 0.25, 0.3] : [0.55, 0.2, 0.3],
      angle: birch ? [38, 35, 30] : [58, 42, 36],
      ratio: birch ? [0.48, 0.5, 0.45] : [0.95, 0.55, 0.45],
      gravity: birch ? [0.05, 0.25, 0.5] : [0.02, 0.06, 0.1],
      wander: 0.3,
      leavesPerTwig: birch ? 7 : 6,
      leafSize: birch ? 0.085 : 0.115,
      envelope: (z) =>
        Math.max(0.25, 1 - Math.abs(z - crownZ) * (birch ? 1.1 : 1.4)),
    });
  } else if (s.form === "pine" || s.form === "spruce") {
    const pine = s.form === "pine";
    const trunk = limb(
      [0, 0, 0],
      [(rand() - 0.5) * (pine ? 0.15 : 0.03), (rand() - 0.5) * 0.05, 1],
      1,
      0.03,
      0.004,
      { wander: pine ? 0.1 : 0.03, segments: 10, sides: 8 },
    );
    const whorls = pine ? 8 : 14;
    for (let w = 0; w < whorls; w++) {
      const t = (pine ? 0.55 : 0.18) + (w / whorls) * (pine ? 0.42 : 0.78);
      const p = pointOn(trunk, t);
      const arms = pine
        ? 4 + Math.floor(rand() * 2)
        : 5 + Math.floor(rand() * 2);
      const spin = rand() * Math.PI * 2;
      const reach = pine
        ? 0.18 * Math.sin(Math.PI * (0.25 + 0.75 * (w / whorls))) + 0.04
        : 0.24 * (1 - (w / whorls) * 0.92) + 0.02;
      for (let a = 0; a < arms; a++) {
        const ang = spin + (a / arms) * Math.PI * 2 + (rand() - 0.5) * 0.5;
        const dir = [
          Math.cos(ang),
          Math.sin(ang),
          pine ? 0.25 + rand() * 0.2 : -0.12 + rand() * 0.1,
        ];
        const arm = limb(
          p.slice(0, 3),
          dir,
          reach * (0.8 + rand() * 0.4),
          p[3] * 0.45,
          0.002,
          { gravity: pine ? 0.02 : 0.08, wander: 0.15, segments: 4, sides: 4 },
        );
        const tufts = pine ? 6 : 7;
        for (let i = 0; i < tufts; i++) {
          const q = pointOn(arm, 0.25 + (i / tufts) * 0.75);
          const d = vec.norm([
            dir[0] + (rand() - 0.5) * 0.6,
            dir[1] + (rand() - 0.5) * 0.6,
            (pine ? 0.4 : 0.1) + rand() * 0.3,
          ]);
          leafAt(
            q.slice(0, 3),
            d,
            (pine ? 0.085 : 0.075) * (0.8 + rand() * 0.4),
          );
        }
      }
    }
    if (!pine) {
      for (let i = 0; i < 4; i++)
        leafAt(pointOn(trunk, 0.96 + i * 0.01).slice(0, 3), [0, 0, 1], 0.06);
    }
  } else if (s.form === "cypress") {
    const trunk = limb([0, 0, 0], [0, 0, 1], 0.98, 0.03, 0.004, {
      wander: 0.02,
      segments: 8,
      sides: 7,
    });
    for (let i = 0; i < 70; i++) {
      const t = 0.08 + (i / 70) * 0.9;
      const p = pointOn(trunk, t);
      const ang = i * 2.39996;
      const reach = 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.02;
      const dir = vec.norm([Math.cos(ang), Math.sin(ang), 1.6]);
      const twig = limb(p.slice(0, 3), dir, reach * 1.2, p[3] * 0.4, 0.002, {
        segments: 2,
        sides: 3,
        wander: 0.1,
      });
      for (let k = 0; k < 2; k++)
        leafAt(
          pointOn(twig, 0.5 + k * 0.4).slice(0, 3),
          vec.norm([dir[0], dir[1], 0.8]),
          0.075 * (0.8 + rand() * 0.4),
        );
    }
  } else if (s.form === "shrub") {
    const stems = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < stems; i++) {
      const ang = (i / stems) * Math.PI * 2 + rand();
      const dir = [Math.cos(ang) * 0.45, Math.sin(ang) * 0.45, 1];
      const stem = limb(
        [Math.cos(ang) * 0.05, Math.sin(ang) * 0.05, 0],
        dir,
        0.65 + rand() * 0.25,
        0.018,
        0.006,
        { segments: 4, sides: 5, wander: 0.3 },
      );
      branchOut(stem, 1, {
        levels: 3,
        children: [0, 4, 3],
        start: [0, 0.3, 0.3],
        angle: [0, 45, 40],
        ratio: [0, 0.45, 0.4],
        gravity: [0, 0.1, 0.2],
        wander: 0.35,
        leavesPerTwig: 5,
        leafSize: 0.24,
      });
    }
  } else if (s.form === "fern") {
    const fronds = 9 + Math.floor(rand() * 4);
    for (let i = 0; i < fronds; i++) {
      const ang = (i / fronds) * Math.PI * 2 + rand() * 0.4;
      const tilt = 0.6 + rand() * 0.5;
      const out = [Math.cos(ang), Math.sin(ang), 0];
      const up = vec.norm([out[0] * tilt, out[1] * tilt, 1]);
      const side = vec.norm(vec.cross(up, out));
      const L = 0.85 + rand() * 0.25;
      const w = 0.32;
      const base = [0, 0, 0];
      const tip = vec.scale(up, L);
      const [u0, v0, u1, v1] = foliageCellUV(Math.floor(rand() * 4));
      const tint = toHex(0.85 + rand() * 0.3, "#ffffff");
      quad(
        leaves,
        [
          vec.add(base, vec.scale(side, -w / 2)),
          vec.add(base, vec.scale(side, w / 2)),
          vec.add(tip, vec.scale(side, w / 2)),
          vec.add(tip, vec.scale(side, -w / 2)),
        ],
        tint,
        [
          [u0, v1],
          [u1, v1],
          [u1, v0],
          [u0, v0],
        ],
      );
    }
  } else if (s.form === "grass") {
    const blades = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < blades; i++) {
      const ang = (i / blades) * Math.PI + rand() * 0.5;
      const off = [(rand() - 0.5) * 0.25, (rand() - 0.5) * 0.25, 0];
      const side = [Math.cos(ang) * 0.5, Math.sin(ang) * 0.5, 0];
      const h = 0.8 + rand() * 0.3;
      const lean = [(rand() - 0.5) * 0.25, (rand() - 0.5) * 0.25, h];
      const [u0, v0, u1, v1] = foliageCellUV(Math.floor(rand() * 4));
      const tint = toHex(0.85 + rand() * 0.3, "#ffffff");
      quad(
        leaves,
        [
          vec.sub(off, side),
          vec.add(off, side),
          vec.add(vec.add(off, side), lean),
          vec.add(vec.sub(off, side), lean),
        ],
        tint,
        [
          [u0, v1],
          [u1, v1],
          [u1, v0],
          [u0, v0],
        ],
      );
    }
  }

  // Foliage cards, darker inside the crown so it reads as a volume.
  if (cards.length) {
    const centre = cards
      .reduce((c, k) => vec.add(c, k.at), [0, 0, 0])
      .map((v) => v / cards.length);
    const radius =
      Math.max(...cards.map((k) => vec.len(vec.sub(k.at, centre)))) || 1;
    for (const k of cards) {
      const outward = vec.len(vec.sub(k.at, centre)) / radius;
      const light =
        0.55 +
        outward * 0.5 +
        (k.at[2] - centre[2]) * 0.4 +
        (rand() - 0.5) * 0.12;
      const up = Math.abs(k.dir[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
      card(
        leaves,
        k.at,
        k.dir,
        up,
        k.size,
        foliageCellUV(k.cell),
        toHex(Math.max(0.35, Math.min(1.15, light)), "#ffffff"),
      );
    }
  }

  // Normalise to exactly 1 unit tall so an instance's scale is its height.
  let top = 0;
  for (const q of [bark, leaves]) for (let i = 2; i < q.vertices.length; i += 3) top = Math.max(top, q.vertices[i]);
  if (top > 0) for (const q of [bark, leaves]) q.vertices = q.vertices.map((v) => Math.round((v / top) * 1000) / 1000);

  const parts = [];
  if (bark.faces.length)
    parts.push({
      ...finish(bark),
      material: textured(s.bark, { roughness: 0.95 }),
    });
  if (leaves.faces.length)
    parts.push({ ...finish(leaves), material: foliageMaterial(s.foliage) });
  return parts;
}
