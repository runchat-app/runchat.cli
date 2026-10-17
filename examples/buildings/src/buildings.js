// Building massing as meshes: walls, glazing bands and a roof, in local
// coordinates around the building's centre at its base. Metres, Z up.
import { box, finish, gable, part, shed } from "./geom.js";

export const WALLS = {
  timber: { color: "#a0703f", roughness: 0.8 },
  charred: { color: "#2e2b28", roughness: 0.9 },
  brick: { color: "#9c4a32", roughness: 0.92 },
  concrete: { color: "#bdb9b0", roughness: 0.85 },
  render: { color: "#efeae0", roughness: 0.9 },
  corten: { color: "#8b4a2b", roughness: 0.6, metalness: 0.3 },
};
export const ROOFS = {
  zinc: { color: "#7b8085", roughness: 0.4, metalness: 0.5 },
  tile: { color: "#8a3f2c", roughness: 0.85 },
  sedum: { color: "#6d8b4b", roughness: 1 },
  timber: { color: "#8a6a45", roughness: 0.85 },
  concrete: { color: "#a9a59d", roughness: 0.9 },
};
export const ROOF_FORMS = ["flat", "gable", "shed"];
const GLASS = {
  color: "#9fc4d6",
  roughness: 0.05,
  metalness: 0.2,
  opacity: 0.5,
};

export const DEFAULT_BUILDING = {
  w: 10,
  d: 7,
  floors: 2,
  fh: 3.1,
  roof: "gable",
  wall: "timber",
  roof_material: "zinc",
  rot: 0,
};

/** Parts for one building. depth = how far the walls run down into sloping ground. */
export function buildingParts(b, depth = 0) {
  const walls = part();
  const glass = part();
  const roof = part();
  const H = b.floors * b.fh;
  box(walls, { cx: 0, cy: 0, z0: -depth, w: b.w, d: b.d, h: H + depth });
  for (let f = 0; f < b.floors; f++) {
    const z0 = f * b.fh + b.fh * 0.25;
    const h = b.fh * 0.5;
    box(glass, { cx: 0, cy: -b.d / 2 - 0.03, z0, w: b.w * 0.78, d: 0.08, h });
    box(glass, { cx: 0, cy: b.d / 2 + 0.03, z0, w: b.w * 0.78, d: 0.08, h });
    box(glass, { cx: -b.w / 2 - 0.03, cy: 0, z0, w: 0.08, d: b.d * 0.6, h });
  }
  const rise = Math.min(b.w, b.d) * 0.35;
  if (b.roof === "gable")
    gable(roof, { cx: 0, cy: 0, z0: H, w: b.w, d: b.d, rise });
  else if (b.roof === "shed")
    shed(roof, { cx: 0, cy: 0, z0: H, w: b.w, d: b.d, rise: rise * 0.6 });
  else box(roof, { cx: 0, cy: 0, z0: H, w: b.w + 0.3, d: b.d + 0.3, h: 0.35 });
  const wallMaterial = {
    ...WALLS[b.wall],
    ...(b.wall_texture && { map: b.wall_texture, color: "#ffffff" }),
  };
  return [
    { ...finish(walls), material: wallMaterial },
    { ...finish(glass), material: GLASS },
    { ...finish(roof), material: ROOFS[b.roof_material] },
  ];
}

export function footprintCorners(b) {
  const a = (b.rot * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, 0],
  ].map(([sx, sy]) => {
    const x = (sx * b.w) / 2;
    const y = (sy * b.d) / 2;
    return [
      b.x + x * Math.cos(a) - y * Math.sin(a),
      b.y + x * Math.sin(a) + y * Math.cos(a),
    ];
  });
}
