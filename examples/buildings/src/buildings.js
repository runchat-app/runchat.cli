// Building models: façades with real window openings (reveals, frames,
// recessed glass, dark interiors), a door, a plinth set into the ground,
// roofs with thickness, overhangs and trims, optional balconies and
// chimneys — all with textures at true scale. Local coordinates: centred on
// the building, ground floor at z = 0, Z up.
import { box, finish, part, quad, vec, wall } from "./geom.js";
import { TILE_M, textured } from "./textures.js";

export const WALLS = {
  timber: { texture: "boards", trim: "#3d3328" },
  charred: { texture: "charred", trim: "#1c1a18" },
  brick: { texture: "brick", trim: "#d8d2c6" },
  concrete: { texture: "concrete", trim: "#9c988f" },
  render: { texture: "render", trim: "#6b665e" },
  corten: { texture: "corten", trim: "#3b2a20" },
};
export const ROOFS = {
  zinc: { texture: "zinc", metalness: 0.55, roughness: 0.38 },
  tile: { texture: "tiles", roughness: 0.8 },
  sedum: { texture: "sedum", roughness: 1 },
  timber: { texture: "boards", roughness: 0.85 },
  concrete: { texture: "concrete", roughness: 0.9 },
};
export const ROOF_FORMS = ["flat", "gable", "shed"];

export const DEFAULT_BUILDING = {
  w: 10,
  d: 7,
  floors: 2,
  fh: 3.1,
  roof: "gable",
  wall: "timber",
  roof_material: "zinc",
  rot: 0,
  balcony: true,
  window: "regular",
};

const FRAME = { color: "#2b2e31", roughness: 0.45, metalness: 0.6 };
const GLASS = {
  color: "#86a9ba",
  roughness: 0.02,
  metalness: 0.1,
  opacity: 0.38,
};
const INTERIOR = { color: "#24211e", roughness: 1 };
const DOOR = { color: "#4a3020", roughness: 0.7 };

export function texturesFor(b) {
  return [WALLS[b.wall].texture, ROOFS[b.roof_material].texture, "concrete"];
}

/** Parts for one building. depth = how far the plinth runs down into sloping ground. */
export function buildingParts(b, depth = 0) {
  const P = {
    walls: part(),
    plinth: part(),
    frames: part(),
    glass: part(),
    interior: part(),
    roof: part(),
    trim: part(),
    door: part(),
  };
  const wallTex = WALLS[b.wall].texture;
  const wallTile = TILE_M[wallTex];
  const roofTex = ROOFS[b.roof_material].texture;
  const roofTile = TILE_M[roofTex];
  const H = b.floors * b.fh;
  const hw = b.w / 2;
  const hd = b.d / 2;
  const plinthTop = 0.45;
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];

  box(P.plinth, {
    cx: 0,
    cy: 0,
    z0: -depth - 0.3,
    w: b.w + 0.12,
    d: b.d + 0.12,
    h: depth + 0.3 + plinthTop,
    tile: TILE_M.concrete,
  });

  const style = b.window === "regular" ? "punched" : b.window ?? "punched";
  const wide = style === "wide" || style === "picture";
  const ribbon = style === "ribbon";
  for (let side = 0; side < 4; side++) {
    const a = corners[side];
    const c = corners[(side + 1) % 4];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const axis = vec.norm([c[0] - a[0], c[1] - a[1], 0]);
    const n = [axis[1], -axis[0], 0];
    const p = (u, z, inset = 0) => [
      a[0] + axis[0] * u - n[0] * inset,
      a[1] + axis[1] * u - n[1] * inset,
      z,
    ];
    const ww = ribbon ? Math.max(1, L - 1.6) : wide ? Math.min(3.2, L * 0.28) : (b.window_width ?? 1.35);
    const spacing = ribbon ? L : (b.window_spacing ?? (wide ? ww + 1.2 : 2.7));
    const count = style === "none" ? 1 : Math.max(1, Math.floor((L - 0.8) / spacing));
    const pad = (L - count * ww) / (count + 1);
    for (let f = 0; f < b.floors; f++) {
      const z0 = f === 0 ? plinthTop : f * b.fh;
      const z1 = (f + 1) * b.fh;
      const front = side === 0 && f === 0;
      const openings = [];
      for (let i = 0; i < count; i++) {
        const u0 = pad + i * (ww + pad);
        const isDoor = front && i === Math.floor(count / 2);
        if (style === "none" && !isDoor) continue;
        const sill = isDoor ? z0 : f * b.fh + (b.sill ?? (wide ? 0.25 : 0.9));
        const head = f * b.fh + b.fh * (b.window_height ?? (wide ? 0.88 : ribbon ? 0.72 : 0.78));
        openings.push({
          u0: isDoor ? u0 + ww / 2 - 0.55 : u0,
          u1: isDoor ? u0 + ww / 2 + 0.55 : u0 + ww,
          sill,
          head,
          door: isDoor,
        });
      }
      // Wall surface around the openings, band by band.
      const sills = Math.min(...openings.map((o) => o.sill));
      const heads = Math.max(...openings.map((o) => o.head));
      if (sills > z0)
        wall(P.walls, [p(0, z0), p(L, z0), p(L, sills), p(0, sills)], wallTile);
      wall(P.walls, [p(0, heads), p(L, heads), p(L, z1), p(0, z1)], wallTile);
      let cursor = 0;
      for (const o of openings) {
        wall(
          P.walls,
          [p(cursor, sills), p(o.u0, sills), p(o.u0, heads), p(cursor, heads)],
          wallTile,
        );
        if (o.sill > sills)
          wall(
            P.walls,
            [p(o.u0, sills), p(o.u1, sills), p(o.u1, o.sill), p(o.u0, o.sill)],
            wallTile,
          );
        if (o.head < heads)
          wall(
            P.walls,
            [p(o.u0, o.head), p(o.u1, o.head), p(o.u1, heads), p(o.u0, heads)],
            wallTile,
          );
        cursor = o.u1;
      }
      wall(
        P.walls,
        [p(cursor, sills), p(L, sills), p(L, heads), p(cursor, heads)],
        wallTile,
      );

      for (const o of openings) {
        const r = 0.22;
        // Reveals: the wall's thickness, seen in the opening.
        wall(
          P.walls,
          [
            p(o.u0, o.sill, r),
            p(o.u0, o.sill, 0),
            p(o.u0, o.head, 0),
            p(o.u0, o.head, r),
          ],
          wallTile,
        );
        wall(
          P.walls,
          [
            p(o.u1, o.sill, 0),
            p(o.u1, o.sill, r),
            p(o.u1, o.head, r),
            p(o.u1, o.head, 0),
          ],
          wallTile,
        );
        wall(
          P.walls,
          [
            p(o.u0, o.head, 0),
            p(o.u1, o.head, 0),
            p(o.u1, o.head, r),
            p(o.u0, o.head, r),
          ],
          wallTile,
        );
        if (!o.door)
          wall(
            P.walls,
            [
              p(o.u0, o.sill, r),
              p(o.u1, o.sill, r),
              p(o.u1, o.sill, 0),
              p(o.u0, o.sill, 0),
            ],
            wallTile,
          );
        const inset = 0.16;
        const fw = 0.06;
        const frame = (u0, u1, zz0, zz1) => {
          const pts = [
            p(u0, zz0, inset - 0.03),
            p(u1, zz0, inset - 0.03),
            p(u1, zz1, inset - 0.03),
            p(u0, zz1, inset - 0.03),
          ];
          quad(P.frames, pts);
          quad(P.frames, [
            p(u0, zz0, inset + 0.04),
            p(u0, zz0, inset - 0.03),
            p(u0, zz1, inset - 0.03),
            p(u0, zz1, inset + 0.04),
          ]);
          quad(P.frames, [
            p(u1, zz0, inset - 0.03),
            p(u1, zz0, inset + 0.04),
            p(u1, zz1, inset + 0.04),
            p(u1, zz1, inset - 0.03),
          ]);
          quad(P.frames, [
            p(u0, zz1, inset - 0.03),
            p(u1, zz1, inset - 0.03),
            p(u1, zz1, inset + 0.04),
            p(u0, zz1, inset + 0.04),
          ]);
        };
        frame(o.u0, o.u1, o.head - fw, o.head);
        frame(o.u0, o.u0 + fw, o.sill, o.head);
        frame(o.u1 - fw, o.u1, o.sill, o.head);
        if (o.door) {
          quad(P.door, [
            p(o.u0 + fw, o.sill, inset + 0.02),
            p(o.u1 - fw, o.sill, inset + 0.02),
            p(o.u1 - fw, o.head - fw, inset + 0.02),
            p(o.u0 + fw, o.head - fw, inset + 0.02),
          ]);
          box(P.trim, {
            cx: p((o.u0 + o.u1) / 2, 0, -0.5)[0],
            cy: p((o.u0 + o.u1) / 2, 0, -0.5)[1],
            z0: o.head + 0.25,
            w: o.u1 - o.u0 + 1.2,
            d: 1.1,
            h: 0.12,
            angle: Math.atan2(axis[1], axis[0]),
          });
          continue;
        }
        frame(o.u0, o.u1, o.sill, o.sill + fw);
        if (o.u1 - o.u0 > 1.2) {
          const m = (o.u0 + o.u1) / 2;
          frame(m - fw / 2, m + fw / 2, o.sill, o.head);
        }
        if (b.floors > 1 && !wide) {
          const t = o.sill + (o.head - o.sill) * 0.72;
          frame(o.u0, o.u1, t - fw / 2, t + fw / 2);
        }
        quad(P.glass, [
          p(o.u0, o.sill, inset),
          p(o.u1, o.sill, inset),
          p(o.u1, o.head, inset),
          p(o.u0, o.head, inset),
        ]);
        quad(P.interior, [
          p(o.u0, o.sill, 0.9),
          p(o.u1, o.sill, 0.9),
          p(o.u1, o.head, 0.9),
          p(o.u0, o.head, 0.9),
        ]);
        // Sill: a thin ledge under the window.
        const mid = p((o.u0 + o.u1) / 2, 0, -0.04);
        box(P.trim, {
          cx: mid[0],
          cy: mid[1],
          z0: o.sill - 0.05,
          w: o.u1 - o.u0 + 0.12,
          d: 0.26,
          h: 0.05,
          angle: Math.atan2(axis[1], axis[0]),
        });
      }
    }
  }

  // Roof.
  const roofMat = textured(roofTex, {
    roughness: ROOFS[b.roof_material].roughness,
    metalness: ROOFS[b.roof_material].metalness ?? 0,
  });
  if (b.roof === "gable" || b.roof === "shed") {
    const gable = b.roof === "gable";
    const ov = b.overhang ?? 0.45;
    const rise =
      b.roof_pitch != null
        ? Math.tan((Math.min(60, Math.max(3, b.roof_pitch)) * Math.PI) / 180) * (gable ? hd : b.d)
        : gable
          ? Math.min(b.w, b.d) * 0.36
          : Math.min(b.w, b.d) * 0.22;
    const th = 0.22;
    const zAt = (y) =>
      gable ? H + rise * (1 - Math.abs(y) / hd) : H + rise * ((y + hd) / b.d);
    const X = hw + ov * 0.7;
    const slopes = gable
      ? [
          [-hd - ov, 0],
          [0, hd + ov],
        ]
      : [[-hd - ov, hd + ov]];
    for (const [y0, y1] of slopes) {
      const e0 = [y0, zAt(y0) + (y0 < 0 && gable ? 0 : 0)];
      const za = gable ? H + rise * (1 - Math.abs(y0) / hd) : zAt(y0);
      const zb = gable ? H + rise * (1 - Math.abs(y1) / hd) : zAt(y1);
      const run = Math.hypot(y1 - y0, zb - za);
      const top = [
        [-X, y0, za + th],
        [X, y0, za + th],
        [X, y1, zb + th],
        [-X, y1, zb + th],
      ];
      const uv = top.map((q, i) => [
        q[0] / roofTile,
        (i < 2 ? 0 : run) / roofTile,
      ]);
      quad(P.roof, top, undefined, uv);
      quad(P.trim, [
        [-X, y1, zb],
        [X, y1, zb],
        [X, y0, za],
        [-X, y0, za],
      ]);
      quad(P.trim, [
        [-X, y0, za],
        [X, y0, za],
        [X, y0, za + th],
        [-X, y0, za + th],
      ]);
      quad(P.trim, [
        [X, y1, zb],
        [-X, y1, zb],
        [-X, y1, zb + th],
        [X, y1, zb + th],
      ]);
      for (const sx of [-X, X]) {
        quad(P.trim, [
          [sx, y0, za],
          [sx, y1, zb],
          [sx, y1, zb + th],
          [sx, y0, za + th],
        ]);
      }
      void e0;
    }
    if (gable) {
      box(P.trim, {
        cx: 0,
        cy: 0,
        z0: H + rise + th - 0.05,
        w: 2 * X,
        d: 0.28,
        h: 0.12,
      });
      for (const sx of [-hw, hw]) {
        wall(
          P.walls,
          sx < 0
            ? [
                [sx, hd, H],
                [sx, -hd, H],
                [sx, 0, H + rise],
              ].concat([[sx, 0, H + rise]])
            : [
                [sx, -hd, H],
                [sx, hd, H],
                [sx, 0, H + rise],
                [sx, 0, H + rise],
              ],
          wallTile,
        );
      }
      if (b.chimney === true || (b.chimney !== false && ["brick", "render"].includes(b.wall))) {
        box(P.walls, {
          cx: hw * 0.45,
          cy: hd * 0.35,
          z0: H + rise * 0.4,
          w: 0.7,
          d: 0.7,
          h: rise * 0.75 + 0.9,
          tile: wallTile,
        });
        box(P.trim, {
          cx: hw * 0.45,
          cy: hd * 0.35,
          z0: H + rise * 1.15 + 0.9,
          w: 0.82,
          d: 0.82,
          h: 0.1,
        });
      }
    } else {
      for (const sx of [-hw, hw]) {
        wall(
          P.walls,
          sx < 0
            ? [
                [sx, hd, H],
                [sx, -hd, H],
                [sx, -hd, H],
                [sx, hd, H + rise],
              ]
            : [
                [sx, -hd, H],
                [sx, hd, H],
                [sx, hd, H + rise],
                [sx, -hd, H],
              ],
          wallTile,
        );
      }
    }
  } else {
    const ph = 0.65;
    const t = 0.25;
    for (let side = 0; side < 4; side++) {
      const a = corners[side];
      const c = corners[(side + 1) % 4];
      wall(
        P.walls,
        [
          [a[0], a[1], H],
          [c[0], c[1], H],
          [c[0], c[1], H + ph],
          [a[0], a[1], H + ph],
        ],
        wallTile,
      );
      const axis = vec.norm([c[0] - a[0], c[1] - a[1], 0]);
      const n = [axis[1], -axis[0], 0];
      const ia = [a[0] - n[0] * t + axis[0] * t, a[1] - n[1] * t + axis[1] * t];
      const ic = [c[0] - n[0] * t - axis[0] * t, c[1] - n[1] * t - axis[1] * t];
      wall(
        P.walls,
        [
          [ic[0], ic[1], H],
          [ia[0], ia[1], H],
          [ia[0], ia[1], H + ph],
          [ic[0], ic[1], H + ph],
        ],
        wallTile,
      );
      const mid = [
        (a[0] + c[0]) / 2 - n[0] * t * 0.5,
        (a[1] + c[1]) / 2 - n[1] * t * 0.5,
      ];
      box(P.trim, {
        cx: mid[0],
        cy: mid[1],
        z0: H + ph,
        w: Math.hypot(c[0] - a[0], c[1] - a[1]) + 0.08,
        d: t + 0.1,
        h: 0.08,
        angle: Math.atan2(axis[1], axis[0]),
      });
    }
    const z = H + 0.12;
    const r = [hw - t, hd - t];
    quad(
      P.roof,
      [
        [-r[0], -r[1], z],
        [r[0], -r[1], z],
        [r[0], r[1], z],
        [-r[0], r[1], z],
      ],
      undefined,
      [
        [-r[0] / roofTile, -r[1] / roofTile],
        [r[0] / roofTile, -r[1] / roofTile],
        [r[0] / roofTile, r[1] / roofTile],
        [-r[0] / roofTile, r[1] / roofTile],
      ],
    );
  }

  // Balconies on the front, one per upper floor.
  if (b.balcony && b.floors > 1) {
    const bw = Math.min(b.w * 0.55, 6);
    for (let f = 1; f < b.floors; f++) {
      const z = f * b.fh;
      box(P.plinth, {
        cx: 0,
        cy: -hd - 0.7,
        z0: z - 0.18,
        w: bw,
        d: 1.4,
        h: 0.18,
        tile: TILE_M.concrete,
      });
      quad(P.glass, [
        [-bw / 2, -hd - 1.38, z],
        [bw / 2, -hd - 1.38, z],
        [bw / 2, -hd - 1.38, z + 1.05],
        [-bw / 2, -hd - 1.38, z + 1.05],
      ]);
      box(P.frames, {
        cx: 0,
        cy: -hd - 1.38,
        z0: z + 1.05,
        w: bw,
        d: 0.06,
        h: 0.05,
      });
    }
  }

  const trimColor = WALLS[b.wall].trim;
  const wallMaterial = b.wall_texture
    ? { map: b.wall_texture, color: "#ffffff", roughness: 0.85 }
    : textured(wallTex, { roughness: 0.88 });
  const parts = [
    [P.walls, wallMaterial],
    [P.plinth, textured("concrete", { roughness: 0.9 })],
    [P.frames, { ...FRAME, ...(b.frame_color && { color: b.frame_color }) }],
    [P.glass, GLASS],
    [P.interior, INTERIOR],
    [P.roof, roofMat],
    [P.trim, { color: trimColor, roughness: 0.6, metalness: 0.2 }],
    [P.door, DOOR],
  ];
  return parts
    .filter(([q]) => q.faces.length)
    .map(([q, material]) => {
      const textured_ = material.map || material.normalMap;
      if (!textured_) q.uvs = [];
      return { ...finish(q), material };
    });
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
