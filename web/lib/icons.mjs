const paths = {
  logo: '<path d="M5 4h8a4 4 0 0 1 0 8H5zm0 8h9a4 4 0 0 1 0 8H5z"/><path d="m15 2 5 0 0 5m0-5-8 8"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.7"/><rect x="14" y="3" width="7" height="7" rx="1.7"/><rect x="3" y="14" width="7" height="7" rx="1.7"/><rect x="14" y="14" width="7" height="7" rx="1.7"/>',
  nodes:
    '<rect x="8" y="2" width="8" height="5" rx="1.5"/><rect x="2" y="17" width="8" height="5" rx="1.5"/><rect x="14" y="17" width="8" height="5" rx="1.5"/><path d="M12 7v5M6 17v-5h12v5"/>',
  diff: '<path d="M7 3v18m10-18v18M3 7h8m2 10h8"/>',
  flask:
    '<path d="M9 3h6m-5 0v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2l-6-10V3M7 15h10"/><path d="m10 17 1 0m3 1h1"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
  chart:
    '<path d="M3 3v18h18M7 15l5-6 4 3 5-8"/><circle cx="7" cy="15" r="1"/><circle cx="12" cy="9" r="1"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2"/>',
  presentation:
    '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-4 0 4-3 4 3m-8-10 3-3 3 2 3-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-8z"/>',
  sparkle:
    '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3zm7 0 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',
  file: '<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8m-8 4h6"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3zM3 6V3h7l2 3h7v3"/>',
  method: '<path d="M16 3h-3c-3 0-4 3-4 6v8c0 3-1 4-4 4M6 10h10"/>',
  loop: '<path d="M20 8a8 8 0 0 0-14-2L3 9m0-6v6h6m-5 7a8 8 0 0 0 14 2l3-3m0 6v-6h-6"/>',
  branch: '<path d="m12 2 10 10-10 10L2 12zM12 7v6m0 4h.01"/>',
  variable:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 9 3 6 3-6m3 0v6"/>',
  return: '<path d="M5 5v6h10a5 5 0 0 1 0 10h-3M1 9l4-4 4 4"/>',
  terminal:
    '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/>',
  settings:
    '<path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  moon: '<path d="M21 14A9 9 0 0 1 10 3a9 9 0 1 0 11 11z"/>',
  undo: '<path d="M3 4v7h7M3 11l5-5a7 7 0 1 1 1 13"/>',
  redo: '<path d="M21 4v7h-7m7 0-5-5a7 7 0 1 0-1 13"/>',
  fit: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  focus: '<path d="M2 8V2h6m8 0h6v6M2 16v6h6m8 0h6v-6M8 12h8m-4-4v8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  shield:
    '<path d="M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6z"/><path d="m8 12 3 3 5-6"/>',
  bookmark: '<path d="M5 3h14v19l-7-5-7 5z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  split:
    '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M12 3v18M7 8v8m10-8v8"/>',
  git: '<circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 8v8m12-8v3c0 5-12 0-12 5"/>',
  beaker:
    '<path d="M6 2h12M8 2v7l-5 10a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3L16 9V2M6 15h12"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  table:
    '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20M8 3v18M15 9v12M2 15h20"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5m0 3h.01"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',
  rocket:
    '<path d="M9 15 5 19l-1-4 4-4m1 4 4 1 6-6 2-8-8 2-6 6 1 4m5 2 1 4 4-4-1-4"/><circle cx="16" cy="7" r="2"/>',
};

export function icon(name, className = "", size = 18) {
  const content = paths[name] ?? paths.code;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}

export function nodeIcon(kind) {
  return (
    {
      entry: "method",
      exit: "circleCheck",
      condition: "branch",
      switch: "branch",
      loop: "loop",
      variable: "variable",
      return: "return",
      throw: "warning",
      try: "shield",
      catch: "shield",
    }[kind] ?? "code"
  );
}

export const iconNames = Object.keys(paths);
