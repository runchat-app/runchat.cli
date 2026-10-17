// Find the terrain in the shared scene and sample its height, so anything
// placed by another app sits on the ground. The Terrain app stores its height
// grid in the GLB's mesh extras: { heightfield: { cols, rows, min, max, heights } }.

export async function loadGround(scene, id = "terrain") {
  const object =
    scene.find((o) => o.id === id && o.kind === "mesh" && o.url) ??
    scene.find(
      (o) => o.kind === "mesh" && o.url && /terrain/i.test(o.name ?? ""),
    );
  if (!object) return null;
  const res = await fetch(object.url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  );
  const field = json.meshes?.find((m) => m.extras?.heightfield)?.extras
    .heightfield;
  if (!field) return null;
  const [ox, oy, oz] = object.position ?? [0, 0, 0];
  const { cols, rows, min, max, heights } = field;
  const sample = (x, y) => {
    const u = ((x - ox - min[0]) / (max[0] - min[0])) * (cols - 1);
    const v = ((y - oy - min[1]) / (max[1] - min[1])) * (rows - 1);
    const c = Math.max(0, Math.min(cols - 2, Math.floor(u)));
    const r = Math.max(0, Math.min(rows - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - c));
    const fv = Math.max(0, Math.min(1, v - r));
    const h = (cc, rr) => heights[rr * cols + cc];
    const top = h(c, r) * (1 - fu) + h(c + 1, r) * fu;
    const bottom = h(c, r + 1) * (1 - fu) + h(c + 1, r + 1) * fu;
    return oz + top * (1 - fv) + bottom * fv;
  };
  const slope = (x, y) => {
    const e = 0.5;
    const dx = (sample(x + e, y) - sample(x - e, y)) / (2 * e);
    const dy = (sample(x, y + e) - sample(x, y - e)) / (2 * e);
    return Math.atan(Math.hypot(dx, dy)) * (180 / Math.PI);
  };
  return {
    id: object.id,
    sample,
    slope,
    water: field.water ?? null,
    bounds: [
      [ox + min[0], oy + min[1]],
      [ox + max[0], oy + max[1]],
    ],
  };
}
