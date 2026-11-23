import React, {
  useState, useEffect, useMemo, useRef, memo,
} from 'react';
import {
  parseSvgItem, trimToContent, computeRowsLayout, composeBundleSvg, itemTransform,
} from '../utils/svgUtils';
import { downloadAs } from '../utils/exporters';

/*
 * Bundle v2 — sederhana, seperti set ikon microstock:
 *   1. Pilih vector (dari hasil trace atau upload / drag-drop file SVG)
 *   2. Atur jumlah baris (mis. 2 baris → 4-5 ikon per baris)
 *   3. Semua ikon otomatis dibuat ukurannya seragam, di frame background putih
 *   4. Download SVG / EPS / AI / PNG / JPG
 */

const LS_KEY = 'vtg-bundle-v2';
const DEFAULTS = {
  rows: 2,
  cols: 0,           // 0 = otomatis dari jumlah baris
  width: 2000,
  ratio: 'auto',
  iconSize: 75,      // % dari sel
  gap: 35,           // % dari sel
  margin: 45,        // % dari sel
  background: '#ffffff',
  trim: true,
  lastRow: 'center',
  exportName: 'bundle',
  format: 'svg',
  order: [],         // id vector yang masuk frame, sesuai urutan
};

const RATIOS = [
  { v: 'auto', label: 'Pas (otomatis)' },
  { v: 1, label: '1:1' },
  { v: 4 / 3, label: '4:3' },
  { v: 3 / 2, label: '3:2' },
  { v: 16 / 9, label: '16:9' },
  { v: 2, label: '2:1' },
];

const FORMATS = [
  { id: 'svg', label: 'SVG' },
  { id: 'eps', label: 'EPS' },
  { id: 'ai', label: 'AI' },
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPG' },
];

const CHECKER = {
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
};

function loadSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY)) || {}) }; } catch { return DEFAULTS; }
}

const Thumb = memo(({ svg }) => {
  const url = useMemo(() => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), [svg]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="w-full h-full object-contain" draggable={false} />;
});

const ItemContent = memo(({ parsed }) => (
  <g dangerouslySetInnerHTML={{ __html: `<g ${parsed.rootAttrs}>${parsed.inner}</g>` }} />
));

const Label = ({ children, right }) => (
  <div className="flex items-center justify-between mb-1.5">
    <span className="text-xs font-semibold text-gray-700">{children}</span>
    {right && <span className="text-xs text-gray-500 tabular-nums">{right}</span>}
  </div>
);

const Chips = ({ options, value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((o) => (
      <button
        key={String(o.v)}
        onClick={() => onChange(o.v)}
        className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${
          value === o.v ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:border-indigo-300'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const Range = ({ value, min, max, onChange }) => (
  <input
    type="range" min={min} max={max} value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    className="w-full mb-3"
    style={{ background: `linear-gradient(to right,#5b4fcf ${((value - min) / (max - min)) * 100}%,#e2e1f0 ${((value - min) / (max - min)) * 100}%)` }}
  />
);

const BundleEditor = ({ items, onRename, onDelete, onAddSvgFiles }) => {
  const [st, setSt] = useState(loadSettings);
  const [editingName, setEditingName] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const set = (patch) => setSt((s) => ({ ...s, ...patch }));

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch {}
  }, [st]);

  // parse (+ trim) sekali per item, di-cache
  const cache = useRef(new Map());
  const parsedById = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      const key = `${it.id}:${st.trim ? 1 : 0}`;
      let c = cache.current.get(key);
      if (!c || c.svg !== it.svg) {
        let parsed = null;
        try {
          parsed = parseSvgItem(it.svg, `${it.id}_`);
          if (st.trim) parsed = trimToContent(parsed);
        } catch { parsed = null; }
        c = { svg: it.svg, parsed };
        cache.current.set(key, c);
      }
      if (c.parsed) map[it.id] = c.parsed;
    });
    return map;
  }, [items, st.trim]);

  const itemById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const order = st.order.filter((id) => parsedById[id]);

  const layout = useMemo(
    () => computeRowsLayout(order.map((id) => ({ id, vb: parsedById[id].vb })), st),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order.join(','), parsedById, st.rows, st.cols, st.width, st.ratio, st.iconSize, st.gap, st.margin, st.lastRow],
  );

  const toggle = (id) => set({
    order: order.includes(id) ? order.filter((x) => x !== id) : [...order, id],
  });
  const move = (from, to) => {
    if (to < 0 || to >= order.length || from === to) return;
    const arr = [...order];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    set({ order: arr });
  };

  const onDropFiles = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml');
    if (files.length) onAddSvgFiles(files);
  };

  const buildSvg = () => composeBundleSvg(
    order.map((id) => ({ id, name: itemById[id]?.name, parsed: parsedById[id], pl: layout.placements[id] })),
    { width: layout.width, height: layout.height, background: st.background },
  );

  const handleExport = async () => {
    if (!order.length) return;
    setBusy(true);
    try { await downloadAs(st.format, buildSvg(), st.exportName || 'bundle'); } finally { setBusy(false); }
  };

  // ringkasan isi baris, mis. "5 + 4"
  const rowSummary = useMemo(() => {
    if (!layout.cols) return '';
    const parts = [];
    for (let r = 0; r < layout.rows; r += 1) parts.push(Math.min(layout.cols, order.length - r * layout.cols));
    return parts.join(' + ');
  }, [layout, order.length]);

  const frameAspect = layout.width / layout.height;

  return (
    <div className="flex gap-4 items-start">
      {/* ── 1. Vector saya ── */}
      <div
        className={`w-64 flex-shrink-0 bg-white rounded-2xl border shadow-sm p-3 flex flex-col sticky top-3 max-h-[calc(100vh-1.5rem)] ${dragOver ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropFiles}
      >
        <h2 className="text-sm font-semibold text-indigo-600 mb-2">1. Pilih Vector</h2>
        <button
          onClick={() => fileInput.current?.click()}
          className="w-full border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-xl py-3 text-xs text-indigo-600 font-medium mb-2"
        >
          + Upload / tarik file SVG ke sini
        </button>
        <input
          ref={fileInput} type="file" accept=".svg,image/svg+xml" multiple className="hidden"
          onChange={(e) => { onAddSvgFiles([...e.target.files]); e.target.value = ''; }}
        />
        <div className="flex gap-1.5 mb-2">
          <button onClick={() => set({ order: items.map((i) => i.id).filter((id) => parsedById[id]) })} className="flex-1 text-[11px] py-1 rounded-md border border-gray-200 hover:border-indigo-400 text-gray-600">Pilih semua</button>
          <button onClick={() => set({ order: [] })} className="flex-1 text-[11px] py-1 rounded-md border border-gray-200 hover:border-red-300 text-gray-600">Kosongkan</button>
        </div>
        {items.length === 0 && (
          <p className="text-xs text-gray-400 leading-relaxed mt-3 text-center">
            Belum ada vector.<br />Upload file SVG, atau klik <b>“+ Bundle”</b> setelah trace.
          </p>
        )}
        <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-2 content-start pr-1">
          {items.map((it) => {
            const idx = order.indexOf(it.id);
            const inFrame = idx >= 0;
            return (
              <div
                key={it.id}
                onClick={() => toggle(it.id)}
                className={`group relative rounded-lg border-2 p-1 cursor-pointer ${inFrame ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                title={inFrame ? 'Klik untuk keluarkan' : 'Klik untuk masukkan ke frame'}
              >
                <div className="aspect-square rounded bg-white"><Thumb svg={it.svg} /></div>
                {inFrame && (
                  <span className="absolute top-1.5 left-1.5 min-w-[20px] h-5 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">{idx + 1}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); if (window.confirm(`Hapus "${it.name}"?`)) onDelete(it.id); }}
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white/90 text-gray-500 hover:text-red-600 text-xs hidden group-hover:flex items-center justify-center shadow"
                >×</button>
                {editingName === it.id ? (
                  <input
                    autoFocus defaultValue={it.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { onRename(it.id, e.target.value || it.name); setEditingName(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    className="w-full text-[10px] mt-1 border border-indigo-300 rounded px-1"
                  />
                ) : (
                  <p className="text-[10px] text-gray-600 truncate mt-1 px-0.5" onDoubleClick={(e) => { e.stopPropagation(); setEditingName(it.id); }} title="Double-klik untuk ganti nama">{it.name}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Preview frame ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-indigo-600">Preview Bundle</h2>
            <span className="text-xs text-gray-500">
              {layout.width} × {layout.height}px
              {order.length > 0 && <> · {order.length} vector · {layout.rows} baris ({rowSummary})</>}
            </span>
          </div>
          <div className="bg-gray-100 rounded-xl p-4 flex items-center justify-center">
            <div
              className="w-full shadow-md"
              style={{
                aspectRatio: `${frameAspect}`,
                maxHeight: 'calc(100vh - 260px)',
                maxWidth: `calc((100vh - 260px) * ${frameAspect})`,
                ...(st.background === 'transparent' ? CHECKER : {}),
              }}
            >
              <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-full block">
                {st.background !== 'transparent' && <rect width={layout.width} height={layout.height} fill={st.background} />}
                {order.map((id) => {
                  const pl = layout.placements[id];
                  if (!pl) return null;
                  return (
                    <g key={id} transform={itemTransform(parsedById[id].vb, pl)}>
                      <ItemContent parsed={parsedById[id]} />
                    </g>
                  );
                })}
                {order.length === 0 && (
                  <text x={layout.width / 2} y={layout.height / 2} textAnchor="middle" fontSize={layout.width / 40} fill="#9ca3af">
                    Klik vector di kiri untuk memasukkannya ke frame
                  </text>
                )}
              </svg>
            </div>
          </div>
        </div>

        {/* Urutan (drag untuk pindah) */}
        {order.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
            <p className="text-xs font-semibold text-gray-700 mb-2">Urutan di frame <span className="font-normal text-gray-400">— tarik untuk memindah, kiri→kanan lalu baris berikutnya</span></p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {order.map((id, i) => (
                <div
                  key={id}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
                  className={`relative w-16 flex-shrink-0 rounded-lg border-2 p-1 bg-white cursor-grab ${dragIdx === i ? 'opacity-40' : ''} border-gray-200 hover:border-indigo-300`}
                >
                  <div className="aspect-square"><Thumb svg={itemById[id].svg} /></div>
                  <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="flex justify-between mt-0.5">
                    <button onClick={() => move(i, i - 1)} className="text-[10px] text-gray-400 hover:text-indigo-600 px-1">◀</button>
                    <button onClick={() => toggle(id)} className="text-[10px] text-gray-400 hover:text-red-600 px-1">×</button>
                    <button onClick={() => move(i, i + 1)} className="text-[10px] text-gray-400 hover:text-indigo-600 px-1">▶</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 2. Susunan & 3. Export ── */}
      <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sticky top-3 max-h-[calc(100vh-1.5rem)] overflow-y-auto">
        <h2 className="text-sm font-semibold text-indigo-600 mb-3">2. Susunan</h2>

        <Label>Jumlah baris</Label>
        <div className="flex items-center gap-1.5 mb-3">
          {[1, 2, 3, 4].map((r) => (
            <button
              key={r}
              onClick={() => set({ rows: r, cols: 0 })}
              className={`w-9 h-8 text-xs rounded-lg border font-semibold ${st.cols === 0 && st.rows === r ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}
            >
              {r}
            </button>
          ))}
          <input
            type="number" min={1} max={20} value={st.rows}
            onChange={(e) => set({ rows: Math.max(1, Number(e.target.value) || 1), cols: 0 })}
            className="w-14 h-8 border border-gray-200 rounded-lg px-2 text-xs text-right"
          />
        </div>

        <Label right={st.cols ? `${st.cols} per baris` : 'otomatis'}>Isi per baris</Label>
        <div className="flex items-center gap-1.5 mb-1">
          <button
            onClick={() => set({ cols: 0 })}
            className={`text-xs px-2.5 h-8 rounded-lg border font-medium ${st.cols === 0 ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600'}`}
          >
            Otomatis
          </button>
          {[3, 4, 5, 6].map((c) => (
            <button
              key={c}
              onClick={() => set({ cols: c })}
              className={`w-8 h-8 text-xs rounded-lg border font-semibold ${st.cols === c ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mb-3">
          {order.length ? `${order.length} vector → ${layout.rows} baris: ${rowSummary}` : 'Pilih vector dulu'}
        </p>

        <Label>Baris terakhir (kalau kurang)</Label>
        <div className="mb-4">
          <Chips value={st.lastRow} onChange={(v) => set({ lastRow: v })} options={[{ v: 'center', label: 'Di tengah' }, { v: 'left', label: 'Rata kiri' }]} />
        </div>

        <Label right={`${st.iconSize}%`}>Ukuran ikon</Label>
        <Range value={st.iconSize} min={40} max={100} onChange={(v) => set({ iconSize: v })} />
        <Label right={`${st.gap}%`}>Jarak antar ikon</Label>
        <Range value={st.gap} min={0} max={100} onChange={(v) => set({ gap: v })} />
        <Label right={`${st.margin}%`}>Margin tepi frame</Label>
        <Range value={st.margin} min={0} max={150} onChange={(v) => set({ margin: v })} />

        <label className="flex items-start gap-2 text-xs text-gray-700 mb-4 cursor-pointer">
          <input type="checkbox" checked={st.trim} onChange={(e) => set({ trim: e.target.checked })} className="accent-indigo-600 mt-0.5" />
          <span>
            <b>Samakan ukuran ikon</b>
            <span className="block text-[11px] text-gray-400">Buang ruang kosong & kotak background putih di tiap file, supaya semua ikon tampil sama besar.</span>
          </span>
        </label>

        <h2 className="text-sm font-semibold text-indigo-600 mb-3 pt-3 border-t border-gray-100">3. Frame</h2>
        <Label>Lebar frame</Label>
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {[1000, 2000, 4000, 5000].map((w) => (
            <button
              key={w}
              onClick={() => set({ width: w })}
              className={`text-xs px-2 h-8 rounded-lg border font-medium ${st.width === w ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}
            >
              {w}
            </button>
          ))}
          <input
            type="number" min={200} max={20000} step={100} value={st.width}
            onChange={(e) => set({ width: Math.max(200, Number(e.target.value) || 2000) })}
            className="w-20 h-8 border border-gray-200 rounded-lg px-2 text-xs text-right"
          />
        </div>

        <Label>Bentuk frame</Label>
        <div className="mb-3">
          <Chips value={st.ratio} onChange={(v) => set({ ratio: v })} options={RATIOS} />
        </div>

        <Label>Background</Label>
        <div className="flex items-center gap-1.5 mb-4">
          <Chips
            value={st.background === '#ffffff' ? 'w' : st.background === 'transparent' ? 't' : 'c'}
            onChange={(v) => set({ background: v === 'w' ? '#ffffff' : 'transparent' })}
            options={[{ v: 'w', label: 'Putih' }, { v: 't', label: 'Transparan' }]}
          />
          <input
            type="color"
            value={st.background.startsWith('#') ? st.background : '#ffffff'}
            onChange={(e) => set({ background: e.target.value })}
            className="w-9 h-8 rounded border border-gray-200 cursor-pointer"
            title="Warna lain"
          />
        </div>

        <h2 className="text-sm font-semibold text-indigo-600 mb-3 pt-3 border-t border-gray-100">4. Download</h2>
        <input
          value={st.exportName}
          onChange={(e) => set({ exportName: e.target.value })}
          placeholder="nama file"
          className="w-full border border-gray-200 rounded-lg py-1.5 px-2 text-xs mb-2"
        />
        <div className="grid grid-cols-5 gap-1 mb-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => set({ format: f.id })}
              className={`text-[11px] font-bold py-1.5 rounded-lg border-2 ${st.format === f.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleExport}
          disabled={!order.length || busy}
          className={`w-full py-2.5 rounded-xl font-semibold text-sm ${order.length && !busy ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
        >
          {busy ? 'Menyiapkan…' : `Download ${st.format.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
};

export default BundleEditor;
