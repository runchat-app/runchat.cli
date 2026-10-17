// A landscape design (parameters, features, boulders) as meshes: the ground
// with its baked texture, water, earth sides, cliff faces and boulders. Used
// by the commands to publish to the scene and by the page to preview.
import {
  DEFAULTS,
  bakeTerrain,
  buildTerrain,
  cliffFace,
  heightAt,
  rockModel,
} from "./terrain.js";
import { TILE_M, materialTextures, textured } from "./textures.js";
import { pngTexture } from "./png.js";

export const designOf = (state) => ({
  params: { ...DEFAULTS, ...(state.params ?? {}) },
  features: state.features ?? [],
  rocks: state.rocks ?? [],
});

export function designHash(params, features) {
  const text = JSON.stringify([params, features]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Earth sides down to a base below the lowest ground: the site as a cut-away block. */
function skirt(t) {
  const base = Math.min(t.stats.lowest_m, 0) - 3;
  const { cols, rows, heights, min, max } = t;
  const vertices = [];
  const faces = [];
  const colors = [];
  const edge = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, ah] = pts[i];
      const [bx, by, bh] = pts[i + 1];
      const k = vertices.length / 3;
      vertices.push(ax, ay, base, bx, by, base, bx, by, bh, ax, ay, ah);
      colors.push("#3b2f24", "#3b2f24", "#6a5440", "#6a5440");
      faces.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  };
  const x = (c) => min[0] + ((max[0] - min[0]) * c) / (cols - 1);
  const y = (r) => min[1] + ((max[1] - min[1]) * r) / (rows - 1);
  const h = (c, r) => heights[r * cols + c];
  edge(Array.from({ length: cols }, (_, c) => [x(c), y(0), h(c, 0)]));
  edge(
    Array.from({ length: rows }, (_, r) => [x(cols - 1), y(r), h(cols - 1, r)]),
  );
  edge(
    Array.from({ length: cols }, (_, c) => [
      x(cols - 1 - c),
      y(rows - 1),
      h(cols - 1 - c, rows - 1),
    ]),
  );
  edge(
    Array.from({ length: rows }, (_, r) => [
      x(0),
      y(rows - 1 - r),
      h(0, rows - 1 - r),
    ]),
  );
  const k = vertices.length / 3;
  vertices.push(
    min[0],
    min[1],
    base,
    min[0],
    max[1],
    base,
    max[0],
    max[1],
    base,
    max[0],
    min[1],
    base,
  );
  colors.push("#2e251d", "#2e251d", "#2e251d", "#2e251d");
  faces.push(k, k + 1, k + 2, k, k + 2, k + 3);
  return { vertices, faces, colors, material: { roughness: 1 } };
}

/** Meshes for a design; textures referenced as texture:<id>. */
export function landscapeMeshes({ params, features, rocks }, group) {
  const t = buildTerrain(params, features);
  const key = designHash(params, features);
  const parts = [
    {
      vertices: t.vertices,
      grid: [t.cols, t.rows],
      material: {
        map: `texture:terrain-${key}`,
        normalMap: `texture:terrain-n-${key}`,
        color: "#ffffff",
        roughness: 0.95,
      },
      extras: {
        heightfield: {
          cols: t.cols,
          rows: t.rows,
          min: t.min,
          max: t.max,
          heights: t.heights,
          water: params.water_level,
        },
      },
    },
  ];
  if (params.water_level != null) {
    const [x0, y0] = t.min;
    const [x1, y1] = t.max;
    const z = params.water_level;
    const tile = TILE_M.water;
    parts.push({
      vertices: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
      faces: [0, 1, 2, 0, 2, 3],
      uvs: [
        x0 / tile,
        y0 / tile,
        x1 / tile,
        y0 / tile,
        x1 / tile,
        y1 / tile,
        x0 / tile,
        y1 / tile,
      ],
      material: {
        ...textured("water"),
        map: undefined,
        color: "#24566a",
        roughness: 0.06,
        metalness: 0.05,
        opacity: 0.82,
      },
    });
  }
  parts.push(skirt(t));
  const meshes = [{ id: "terrain", name: "Terrain", parent: group, parts }];
  features
    .filter((f) => f.type === "cliff")
    .forEach((f, i) => {
      meshes.push({
        id: `cliff-${i}`,
        name: `Cliff ${i + 1}`,
        parent: group,
        parts: [
          {
            ...cliffFace(f, params, features),
            material: textured("rock", { roughness: 0.92 }),
          },
        ],
      });
    });
  const byVariant = new Map();
  for (const r of rocks) {
    if (!byVariant.has(r.v)) byVariant.set(r.v, []);
    byVariant.get(r.v).push(r);
  }
  for (const [v, list] of byVariant) {
    meshes.push({
      id: `rocks-${v}`,
      name: "Boulder",
      parent: group,
      parts: [
        { ...rockModel(v), material: textured("rock", { roughness: 0.9 }) },
      ],
      instances: list.map((r) => ({
        position: [
          r.x,
          r.y,
          +(heightAt(params, features, r.x, r.y) - r.s * r.sink).toFixed(3),
        ],
        rotation: [r.tilt, r.tilt * 0.5, r.rot],
        scale: [r.s, r.s * r.sy, r.s],
      })),
    });
  }
  return { meshes, key, terrain: t };
}

/** Textures a design needs that `assets` lacks (base64 PNG entries). */
export async function landscapeTextures(design, key, terrain, assets) {
  const textures = await materialTextures(["rock", "water"], assets);
  if (!assets[`terrain-${key}`]) {
    const baked = bakeTerrain(terrain, design.params, design.features);
    textures.push(
      await pngTexture(
        `terrain-${key}`,
        baked.size,
        baked.size,
        baked.color,
        3,
      ),
    );
    textures.push(
      await pngTexture(
        `terrain-n-${key}`,
        baked.normalSize,
        baked.normalSize,
        baked.normal,
        3,
      ),
    );
  }
  return textures;
}
