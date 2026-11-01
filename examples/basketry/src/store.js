// App state: shared with the canvas through window.runchat when it is there
// and writable, otherwise kept in this browser (published pages, plain files).
const KEY = "basketry-state";

export function applyOps(state, ops) {
  const next = { ...state };
  for (const o of ops) {
    if (o.op === "set") next[o.key] = o.value;
    else if (o.op === "delete") delete next[o.key];
    else if (o.op === "merge")
      next[o.key] = { ...(next[o.key] ?? {}), ...o.value };
    else if (o.op === "append") {
      const list = [...(next[o.key] ?? []), ...o.items];
      next[o.key] = o.max ? list.slice(-o.max) : list;
    } else if (o.op === "clear")
      for (const k of Object.keys(next)) delete next[k];
  }
  return next;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export function createStore(onState) {
  const host = typeof window !== "undefined" ? window.runchat?.state : null;
  let state = {};
  let shared = false;
  let heard = false;
  const notify = (source) => onState(state, source);
  const goLocal = (why) => {
    if (why) console.warn("Basketry: keeping the model in this browser.", why);
    shared = false;
    save(state);
  };
  if (host?.subscribe && host?.apply) {
    try {
      shared = true;
      host.subscribe((s) => {
        heard = true;
        state = s ?? {};
        notify("remote");
      });
    } catch (e) {
      goLocal(e);
      state = load();
    }
  } else state = load();
  // Hosts that never deliver a snapshot (or no host at all) start from local.
  setTimeout(
    () => {
      if (heard) return;
      if (shared && !Object.keys(state).length) state = load();
      notify("init");
    },
    shared ? 1500 : 0,
  );
  return {
    get state() {
      return state;
    },
    get shared() {
      return shared;
    },
    apply(ops) {
      if (!ops?.length) return;
      state = applyOps(state, ops);
      notify("local");
      if (!shared) return save(state);
      try {
        Promise.resolve(host.apply(ops)).catch((e) => {
          goLocal(e);
          notify("local");
        });
      } catch (e) {
        goLocal(e);
      }
    },
  };
}
