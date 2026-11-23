// Utilitas Bundle: parse SVG item, layout grid otomatis, dan gabungkan
// semua item jadi SATU file SVG (yang sama persis dengan yang tampil di editor).

const SKIP_ROOT_ATTRS = new Set([
  'width', 'height', 'viewBox', 'viewbox', 'x', 'y', 'version', 'preserveAspectRatio',
  'id', 'xmlns', 'baseProfile', 'enable-background',
]);

const r3 = (n) => Math.round(n * 1000) / 1000;

let uid = 0;
/**
 * Parse string SVG -> { vb:[minX,minY,w,h], inner, rootAttrs }
 * inner = isi <svg> (tanpa tag root) dengan id yang sudah diberi prefix
 * supaya tidak bentrok saat beberapa file digabung.
 */
export function parseSvgItem(svgString, prefix) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('File bukan SVG yang valid');
  }

  let vb = null;
  const vbAttr = root.getAttribute('viewBox');
  if (vbAttr) {
    const p = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) vb = p;
  }
  if (!vb) {
    const w = parseFloat(root.getAttribute('width')) || 1000;
    const h = parseFloat(root.getAttribute('height')) || 1000;
    vb = [0, 0, w, h];
  }

  const ser = new XMLSerializer();
  let inner = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === 1) {
      const tag = n.nodeName.toLowerCase();
      if (tag === 'metadata' || tag === 'title' || tag === 'desc') return;
      inner += ser.serializeToString(n);
    }
  });
  // XMLSerializer menambahkan xmlns di setiap child — buang supaya ringkas
  inner = inner.replace(/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');

  const px = prefix || `b${(uid += 1)}_`;
  inner = inner
    .replace(/\sid="([^"]+)"/g, (_, id) => ` id="${px}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${px}${id})`)
    .replace(/(\s(?:xlink:)?href)="#([^"]+)"/g, (_, a, id) => `${a}="#${px}${id}"`);

  const rootAttrs = [];
  Array.from(root.attributes).forEach((a) => {
    if (SKIP_ROOT_ATTRS.has(a.name) || a.name.startsWith('xmlns')) return;
    rootAttrs.push(`${a.name}="${a.value.replace(/"/g, '&quot;')}"`);
  });

  return { vb, inner, rootAttrs: rootAttrs.join(' ') };
}

/** Transform satu item: posisi (x,y) = pojok kiri-atas, w = lebar di artboard. */
export function itemTransform(vb, pl) {
  const s = pl.w / vb[2];
  const h = vb[3] * s;
  const parts = [`translate(${r3(pl.x)} ${r3(pl.y)})`];
  if (pl.rot) parts.push(`rotate(${r3(pl.rot)} ${r3(pl.w / 2)} ${r3(h / 2)})`);
  if (pl.flip) parts.push(`translate(${r3(pl.w)} 0) scale(-1 1)`);
  parts.push(`scale(${+s.toFixed(6)})`);
  if (vb[0] || vb[1]) parts.push(`translate(${r3(-vb[0])} ${r3(-vb[1])})`);
  return parts.join(' ');
}

const NS = 'http://www.w3.org/2000/svg';
const SKIP_MEASURE = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'pattern', 'symbol', 'filter']);

function parseColor(c) {
  if (!c || c === 'none' || c === 'transparent') return null;
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

/**
 * "Rapikan ukuran": hitung kotak isi gambar yang SEBENARNYA (tanpa ruang
 * kosong di sekeliling) dan buang kotak background putih/terang yang
 * menutupi hampir seluruh kanvas. Hasilnya: setiap ikon punya ukuran
 * visual yang sama di bundle, seperti set ikon profesional.
 * Hanya berjalan di browser (pakai getBBox). Return parsed baru.
 */
export function trimToContent(parsed) {
  if (typeof document === 'undefined') return parsed;
  const host = document.createElementNS(NS, 'svg');
  host.setAttribute('viewBox', parsed.vb.join(' '));
  host.setAttribute('width', String(parsed.vb[2]));
  host.setAttribute('height', String(parsed.vb[3]));
  host.style.cssText = 'position:absolute;left:-200000px;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(host);
  try {
    host.innerHTML = `<g ${parsed.rootAttrs}>${parsed.inner}</g>`;
    const rootG = host.firstElementChild;
    const vbArea = parsed.vb[2] * parsed.vb[3];
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const toRemove = [];

    Array.from(rootG.children).forEach((el) => {
      if (SKIP_MEASURE.has(el.tagName.toLowerCase())) return;
      // bungkus sementara supaya transform elemen ikut terhitung
      const wrap = document.createElementNS(NS, 'g');
      rootG.insertBefore(wrap, el);
      wrap.appendChild(el);
      let b;
      try { b = wrap.getBBox(); } catch { b = null; }
      rootG.insertBefore(el, wrap);
      rootG.removeChild(wrap);
      if (!b || (b.width <= 0 && b.height <= 0)) return;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const fill = parseColor(cs.fill);
      const stroke = parseColor(cs.stroke);
      const isBg = fill && !stroke && fill.a > 0.5
        && fill.r >= 240 && fill.g >= 240 && fill.b >= 240
        && b.width * b.height >= vbArea * 0.8;
      if (isBg) { toRemove.push(el); return; }
      if (!fill && !stroke) return;

      const sw = stroke ? (parseFloat(cs.strokeWidth) || 0) / 2 : 0;
      x0 = Math.min(x0, b.x - sw); y0 = Math.min(y0, b.y - sw);
      x1 = Math.max(x1, b.x + b.width + sw); y1 = Math.max(y1, b.y + b.height + sw);
    });

    if (!Number.isFinite(x0) || x1 - x0 <= 0 || y1 - y0 <= 0) return parsed;
    toRemove.forEach((el) => el.remove());
    const inner = toRemove.length ? rootG.innerHTML : parsed.inner;
    return { ...parsed, vb: [x0, y0, x1 - x0, y1 - y0], inner };
  } finally {
    host.remove();
  }
}

/**
 * Layout baris (seperti contoh set ikon): semua ikon ditaruh di sel kotak
 * yang sama besar, ikon dipaskan ke sel dengan ukuran seragam.
 *
 * items: [{id, vb}]
 * opts: { width, rows, cols(0=auto), ratio('auto'|angka lebar/tinggi),
 *         iconSize(% sel), gap(% sel), margin(% sel), lastRow('center'|'left') }
 * return { width, height, cols, rows, placements: {id:{x,y,w}} }
 */
export function computeRowsLayout(items, opts) {
  const n = items.length;
  const W = opts.width;
  const g = (opts.gap ?? 30) / 100;
  const m = (opts.margin ?? 50) / 100;
  if (!n) {
    const H0 = opts.ratio && opts.ratio !== 'auto' ? W / opts.ratio : W / 2;
    return { width: W, height: Math.round(H0), cols: 0, rows: 0, placements: {} };
  }
  const cols = Math.max(1, opts.cols > 0 ? Math.min(opts.cols, n) : Math.ceil(n / Math.max(1, opts.rows || 1)));
  const rows = Math.ceil(n / cols);

  // ukuran sel c dari lebar: W = 2*m*c + cols*c + (cols-1)*g*c
  let c = W / (cols + (cols - 1) * g + 2 * m);
  let H;
  if (!opts.ratio || opts.ratio === 'auto') {
    H = c * (rows + (rows - 1) * g + 2 * m);
  } else {
    H = W / opts.ratio;
    c = Math.min(c, H / (rows + (rows - 1) * g + 2 * m));
  }
  const gridW = c * (cols + (cols - 1) * g);
  const gridH = c * (rows + (rows - 1) * g);
  const ox = (W - gridW) / 2;
  const oy = (H - gridH) / 2;
  const box = c * ((opts.iconSize ?? 80) / 100);

  const placements = {};
  items.forEach(({ id, vb }, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const shift = opts.lastRow === 'left' ? 0 : ((cols - inRow) * c * (1 + g)) / 2;
    const s = Math.min(box / vb[2], box / vb[3]);
    const iw = vb[2] * s;
    const ih = vb[3] * s;
    placements[id] = {
      x: ox + shift + col * c * (1 + g) + (c - iw) / 2,
      y: oy + row * c * (1 + g) + (c - ih) / 2,
      w: iw,
    };
  });
  return { width: Math.round(W), height: Math.round(H), cols, rows, placements };
}

/** Gabungkan jadi satu file SVG. entries: [{id,name,parsed,pl}] (urutan = urutan layer). */
export function composeBundleSvg(entries, art) {
  const W = Math.round(art.width);
  const H = Math.round(art.height);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generator: Vector Generate · Bundle -->',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  ];
  if (art.background && art.background !== 'transparent') {
    lines.push(`<rect id="background" x="0" y="0" width="${W}" height="${H}" fill="${art.background}"/>`);
  }
  entries.forEach(({ name, parsed, pl }, i) => {
    const safe = String(name || `item-${i + 1}`).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
    lines.push(
      `<g id="item-${i + 1}-${safe}" transform="${itemTransform(parsed.vb, pl)}">`
      + `<g ${parsed.rootAttrs}>${parsed.inner}</g></g>`,
    );
  });
  lines.push('</svg>');
  return lines.join('\n');
}
