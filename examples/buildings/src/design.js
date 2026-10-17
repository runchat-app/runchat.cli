// One building design, in the names a designer (or agent) uses, plus the
// templates to start from. buildingParts() takes the internal form.
import { ROOFS, ROOF_FORMS, WALLS } from "./buildings.js";

export const WINDOW_STYLES = ["punched", "wide", "ribbon", "none"];

const BASE = {
  name: "building",
  width: 10,
  depth: 7,
  floors: 2,
  floor_height: 3.1,
  roof: "gable",
  roof_pitch: 35,
  overhang: 0.45,
  wall: "timber",
  roof_material: "zinc",
  window: "punched",
  window_width: 1.35,
  window_spacing: 2.7,
  sill: 0.9,
  window_height: 0.78,
  balcony: false,
  chimney: "auto",
  frame_color: "#2b2e31",
  wall_texture: null,
};

const T = (over) => ({ ...BASE, ...over });
export const TEMPLATES = {
  cabin: T({
    name: "Cabin",
    width: 9,
    depth: 6.5,
    floors: 1,
    roof_pitch: 38,
    wall: "charred",
    roof_material: "zinc",
    window: "wide",
  }),
  farmhouse: T({
    name: "Farmhouse",
    width: 14,
    depth: 9,
    floors: 2,
    roof_pitch: 40,
    wall: "brick",
    roof_material: "tile",
    chimney: true,
    frame_color: "#e8e4dc",
  }),
  townhouse: T({
    name: "Townhouse",
    width: 7,
    depth: 11,
    floors: 3,
    roof_pitch: 45,
    wall: "render",
    roof_material: "tile",
    window_width: 1.1,
    window_spacing: 2.2,
    balcony: true,
  }),
  studio: T({
    name: "Studio",
    width: 8,
    depth: 6.5,
    floors: 2,
    roof: "shed",
    roof_pitch: 14,
    wall: "corten",
    roof_material: "zinc",
    window: "ribbon",
  }),
  pavilion: T({
    name: "Pavilion",
    width: 16,
    depth: 10,
    floors: 1,
    floor_height: 4.2,
    roof: "flat",
    wall: "concrete",
    roof_material: "sedum",
    window: "wide",
  }),
  lookout: T({
    name: "Lookout hall",
    width: 16,
    depth: 10,
    floors: 2,
    roof: "flat",
    wall: "concrete",
    roof_material: "sedum",
    window: "wide",
    balcony: true,
  }),
  barn: T({
    name: "Barn",
    width: 18,
    depth: 10,
    floors: 1,
    floor_height: 5.5,
    roof_pitch: 42,
    wall: "timber",
    roof_material: "zinc",
    window: "none",
  }),
};

const num = (v, a, b, d) =>
  typeof v === "number" && isFinite(v) ? Math.min(b, Math.max(a, v)) : d;

export function normalizeDesign(input) {
  const d = { ...BASE, ...(input ?? {}) };
  d.width = num(d.width, 3, 60, BASE.width);
  d.depth = num(d.depth, 3, 40, BASE.depth);
  d.floors = Math.round(num(d.floors, 1, 20, BASE.floors));
  d.floor_height = num(d.floor_height, 2.4, 8, BASE.floor_height);
  d.roof_pitch = num(d.roof_pitch, 3, 60, BASE.roof_pitch);
  d.overhang = num(d.overhang, 0, 2, BASE.overhang);
  d.window_width = num(d.window_width, 0.5, 4, BASE.window_width);
  d.window_spacing = num(d.window_spacing, 0.9, 8, BASE.window_spacing);
  d.sill = num(d.sill, 0, 1.5, BASE.sill);
  d.window_height = num(d.window_height, 0.3, 0.95, BASE.window_height);
  if (!ROOF_FORMS.includes(d.roof)) d.roof = BASE.roof;
  if (!WALLS[d.wall]) d.wall = BASE.wall;
  if (!ROOFS[d.roof_material]) d.roof_material = BASE.roof_material;
  if (!WINDOW_STYLES.includes(d.window)) d.window = BASE.window;
  d.balcony = !!d.balcony;
  if (![true, false, "auto"].includes(d.chimney)) d.chimney = "auto";
  if (!/^#[0-9a-f]{6}$/i.test(d.frame_color)) d.frame_color = BASE.frame_color;
  if (d.wall_texture && !/^https:\/\//.test(d.wall_texture))
    d.wall_texture = null;
  return d;
}

/** The form buildingParts() takes. */
export function toInternal(d) {
  return {
    w: d.width,
    d: d.depth,
    floors: d.floors,
    fh: d.floor_height,
    roof: d.roof,
    roof_pitch: d.roof_pitch,
    overhang: d.overhang,
    wall: d.wall,
    roof_material: d.roof_material,
    window: d.window,
    window_width: d.window_width,
    window_spacing: d.window_spacing,
    sill: d.sill,
    window_height: d.window_height,
    balcony: d.balcony,
    chimney: d.chimney === "auto" ? undefined : d.chimney,
    frame_color: d.frame_color,
    wall_texture: d.wall_texture,
    rot: 0,
  };
}

export function designKey(d) {
  const text = JSON.stringify(d);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  const slug = String(d.name || "building")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 20);
  return `${slug}_${(h >>> 0).toString(36)}`;
}

export function summarize(d) {
  const height = d.floors * d.floor_height;
  return {
    ...d,
    eaves_height_m: +height.toFixed(2),
    floor_area_m2: Math.round(d.width * d.depth * d.floors),
  };
}
