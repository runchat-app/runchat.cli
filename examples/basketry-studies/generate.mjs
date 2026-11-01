// Writes add_rods payloads for the basket studies: the primary frame first,
// then the weave onto it. Drive the app with:
//   runchat app_command --runchat_id <id> --node_id <node> --command add_rods --args @frame-<name>.json
//   runchat app_command --runchat_id <id> --node_id <node> --command add_rods --args @basket-<name>.json
import fs from "fs";
import { DESIGNS, JOIN, stock, withProfiles } from "./designs.mjs";

const PRIMARY = new Set(["cradle", "rib", "ring"]);
for (const [name, gen] of Object.entries(DESIGNS)) {
  const rods = withProfiles(stock(gen()));
  const common = { budget_ms: 8000, per_rod: 16, spacing: 0.5 };
  const frame = { ...common, rods: rods.filter((r) => PRIMARY.has(r.kind)), join_radius: 0.35, min_ties: 0 };
  const basket = { ...common, ...JOIN[name], rods: rods.filter((r) => !PRIMARY.has(r.kind)), join_radius: (JOIN[name]?.join_radius ?? 0.3) + 0.05 };
  fs.writeFileSync(`frame-${name}.json`, JSON.stringify(frame));
  fs.writeFileSync(`basket-${name}.json`, JSON.stringify(basket));
  console.log(name, frame.rods.length, "frame rods,", basket.rods.length, "weave rods");
}
