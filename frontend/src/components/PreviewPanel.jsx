import React, {
  useState, useRef, useEffect, useMemo, useCallback, memo,
} from 'react';

/*
 * PreviewPanel — versi diperbesar
 *  - Tampilan ATAS-BAWAH: gambar original di atas, hasil vector di bawah
 *    (dulu kiri-kanan, jadi masing-masing hanya setengah lebar layar)
 *  - Tinggi preview otomatis menyesuaikan lebar gambar, dan bisa ditarik
 *    lewat garis di bawah tiap panel
 *  - Zoom: Ctrl + scroll (atau pinch trackpad) tepat di posisi kursor, sampai 3200%
 *    Drag untuk menggeser. Double-click = zoom 400% di titik itu / kembali Fit
 *  - Zoom & posisi atas-bawah selalu sinkron, jadi detail yang sama bisa dibandingkan
 *  - Mode Perbandingan (slider) tetap ada
 *  - Layar penuh (tombol / tekan F, keluar Esc)
 * Props sama dengan versi sebelumnya: originalFile, svgResult, isLoading
 */

const MIN_Z = 0.25;
const MAX_Z = 32;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function svgAspect(svg) {
  if (!svg) return null;
  const head = (svg.match(/<svg[^>]*>/) || [''])[0];
  const vb = (head.match(/viewBox="([^"]+)"/) || [])[1];
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p[2] > 0 && p[3] > 0) return p[2] / p[3];
  }
  const w = parseFloat((head.match(/\swidth="([\d.]+)/) || [])[1]);
  const h = parseFloat((head.match(/\sheight="([\d.]+)/) || [])[1]);
  return w > 0 && h > 0 ? w / h : null;
}

function useElementSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// SVG dirender sekali per hasil -> zoom/geser tetap ringan
const SvgLayer = memo(({ svg }) => (
  <div
    className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
    dangerouslySetInnerHTML={{ __html: svg }}
  />
));

/** Satu panel zoom/geser. view {z,x,y} dipakai bersama -> sinkron. */
const Pane = ({
  view, setView, aspect, label, labelClass, children, overlay, wheelZoom,
}) => {
  const ref = useRef(null);
  const size = useElementSize(ref);
  const drag = useRef(null);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(null);

  const base = useMemo(() => {
    if (!size.w || !size.h || !aspect) return { w: 0, h: 0 };
    const pw = size.w * 0.96;
    const ph = size.h * 0.96;
    return pw / ph > aspect ? { w: ph * aspect, h: ph } : { w: pw, h: pw / aspect };
  }, [size, aspect]);

  const zoomAt = useCallback((factor, mx, my) => {
    setView((v) => {
      const z = clamp(v.z * factor, MIN_Z, MAX_Z);
      const k = z / v.z;
      const cx = mx - size.w / 2;
      const cy = my - size.h / 2;
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, [setView, size]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      // Ctrl/⌘/Alt + scroll = zoom. Scroll biasa = geser halaman
      // (kecuali layar penuh: scroll biasa langsung zoom).
      if (!wheelZoom && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setHint(true);
        clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), 1200);
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // ±1.5x per putaran roda mouse; pinch trackpad (delta kecil) tetap halus
      const f = Math.exp(-clamp(e.deltaY, -100, 100) * 0.004);
      zoomAt(f, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, wheelZoom]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // cegah teks di halaman ikut ter-blok saat menggeser
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = () => { drag.current = null; };
  const onDoubleClick = (e) => {
    const r = ref.current.getBoundingClientRect();
    if (view.z > 1.5) setView({ z: 1, x: 0, y: 0 });
    else zoomAt(4 / view.z, e.clientX - r.left, e.clientY - r.top);
  };

  const box = {
    position: 'absolute',
    width: base.w * view.z,
    height: base.h * view.z,
    left: size.w / 2 + view.x - (base.w * view.z) / 2,
    top: size.h / 2 + view.y - (base.h * view.z) / 2,
  };

  return (
    <div
      ref={ref}
      className="relative w-full h-full overflow-hidden select-none cursor-grab active:cursor-grabbing bg-[#f8f9fc]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {base.w > 0 && (typeof children === 'function' ? children(box) : <div style={box}>{children}</div>)}
      {overlay}
      {hint && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
          <span className="bg-black/65 text-white text-xs px-3 py-1.5 rounded-full">Tahan Ctrl + scroll untuk zoom</span>
        </div>
      )}
      {label && (
        <div className={`absolute top-2 left-3 text-xs text-white px-2 py-0.5 rounded pointer-events-none ${labelClass || 'bg-black/50'}`}>
          {label}
        </div>
      )}
    </div>
  );
};

/** Garis tarik untuk mengubah tinggi panel. */
const ResizeBar = ({ height, onChange }) => {
  const start = useRef(null);
  return (
    <div
      className="h-5 flex items-center justify-center cursor-row-resize group select-none touch-none"
      onPointerDown={(e) => { e.preventDefault(); start.current = { y: e.clientY, h: height }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current) onChange(clamp(start.current.h + (e.clientY - start.current.y), 240, 4000)); }}
      onPointerUp={() => { start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
      title="Tarik ke atas/bawah untuk mengubah tinggi"
    >
      <div className="flex items-center gap-2 text-[10px] text-gray-400 group-hover:text-indigo-600">
        <span className="w-16 h-1 rounded-full bg-gray-300 group-hover:bg-indigo-400" />
        tinggi {Math.round(height)}px · tarik
        <span className="w-16 h-1 rounded-full bg-gray-300 group-hover:bg-indigo-400" />
      </div>
    </div>
  );
};

const EmptyState = ({ icon, text }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300 pointer-events-none">
    {icon === 'image' ? (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ) : (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
        <polyline points="12 22 12 15.5" /><polyline points="22 8.5 12 15.5 2 8.5" />
      </svg>
    )}
    <p className="text-xs">{text}</p>
  </div>
);

const PreviewPanel = ({ originalFile, svgResult, isLoading }) => {
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [compareMode, setCompareMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [full, setFull] = useState(false);
  const [paneH, setPaneH] = useState(null); // null = otomatis
  const [imgAspect, setImgAspect] = useState(null);
  const areaRef = useRef(null);
  const area = useElementSize(areaRef);
  const sliderRef = useRef(null);
  const sliderDrag = useRef(false);

  // object URL dibuat sekali per file (dulu dibuat ulang setiap render)
  const originalUrl = useMemo(() => (originalFile ? URL.createObjectURL(originalFile) : null), [originalFile]);
  useEffect(() => () => { if (originalUrl) URL.revokeObjectURL(originalUrl); }, [originalUrl]);
  useEffect(() => {
    if (!originalUrl) { setImgAspect(null); return; }
    const im = new Image();
    im.onload = () => setImgAspect(im.naturalWidth / im.naturalHeight);
    im.src = originalUrl;
  }, [originalUrl]);
  useEffect(() => { setView({ z: 1, x: 0, y: 0 }); }, [originalFile]);

  // keyboard: F = layar penuh, Esc = keluar, 0 = fit, +/- = zoom
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') setFull(false);
      else if (e.key === 'f' || e.key === 'F') setFull((f) => !f);
      else if (e.key === '0') setView({ z: 1, x: 0, y: 0 });
      else if (e.key === '+' || e.key === '=') setView((v) => ({ z: clamp(v.z * 1.25, MIN_Z, MAX_Z), x: v.x * 1.25, y: v.y * 1.25 }));
      else if (e.key === '-') setView((v) => ({ z: clamp(v.z / 1.25, MIN_Z, MAX_Z), x: v.x / 1.25, y: v.y / 1.25 }));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const aspect = svgAspect(svgResult) || imgAspect || 1;
  // tinggi otomatis: cukup tinggi supaya gambar memenuhi LEBAR panel
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const autoH = Math.round(clamp((area.w || 900) / aspect, 380, vh * 0.85));
  const H = paneH ?? autoH;
  const boxStyle = full ? { flex: 1, minHeight: 0 } : { height: H };

  const zoomBy = (f) => setView((v) => {
    const z = clamp(v.z * f, MIN_Z, MAX_Z);
    const k = z / v.z;
    return { z, x: v.x * k, y: v.y * k };
  });

  const originalContent = originalUrl
    ? <img src={originalUrl} alt="Original" draggable={false} className="w-full h-full block" style={{ imageRendering: view.z > 3 ? 'pixelated' : 'auto' }} />
    : null;
  const vectorContent = svgResult ? <SvgLayer svg={svgResult} /> : null;

  const loading = isLoading && (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/70 pointer-events-none">
      <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      <p className="text-sm text-gray-500 font-medium">Memproses gambar...</p>
      <p className="text-xs text-gray-400">Ini mungkin memerlukan beberapa detik</p>
    </div>
  );

  const frame = (key, content) => (
    <div key={key} className="relative rounded-xl border border-gray-200 overflow-hidden bg-white" style={boxStyle}>
      {content}
    </div>
  );
  const bar = (key) => (full ? null : <ResizeBar key={key} height={H} onChange={setPaneH} />);

  const onSliderMove = (e) => {
    if (!sliderDrag.current || !sliderRef.current) return;
    const r = sliderRef.current.getBoundingClientRect();
    setSliderPos(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100));
  };

  let body;
  if (compareMode && originalUrl && svgResult) {
    // ── Mode perbandingan (slider) ──
    body = [
      frame('compare', (
        <div
          ref={sliderRef}
          className="relative w-full h-full"
          onPointerMove={onSliderMove}
          onPointerUp={() => { sliderDrag.current = false; }}
        >
          <Pane view={view} setView={setView} aspect={aspect} wheelZoom={full}>
            {(box) => (
              <>
                <div style={box} className="bg-white">{vectorContent}</div>
                <div className="absolute inset-0 pointer-events-none bg-[#f8f9fc]" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
                  <div style={box}>{originalContent}</div>
                </div>
              </>
            )}
          </Pane>
          <div
            className="absolute top-0 bottom-0 w-1 bg-indigo-500 cursor-col-resize z-10 flex items-center justify-center"
            style={{ left: `calc(${sliderPos}% - 2px)` }}
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); sliderDrag.current = true; e.currentTarget.parentElement.setPointerCapture(e.pointerId); }}
          >
            <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg border-2 border-white text-white text-[11px] font-bold">⇔</div>
          </div>
          <div className="absolute top-2 left-3 text-xs bg-black/50 text-white px-2 py-0.5 rounded pointer-events-none">Original</div>
          <div className="absolute top-2 right-3 text-xs bg-indigo-600/80 text-white px-2 py-0.5 rounded pointer-events-none">Vector</div>
          {loading}
        </div>
      )),
      bar('bar'),
    ];
  } else {
    // ── Atas-bawah ──
    body = [
      frame('top', (
        <Pane view={view} setView={setView} aspect={aspect} label="Gambar Original" wheelZoom={full}
          overlay={!originalUrl && <EmptyState icon="image" text="Upload gambar terlebih dahulu" />}
        >
          {originalContent}
        </Pane>
      )),
      bar('bar1'),
      frame('bottom', (
        <Pane view={view} setView={setView} aspect={aspect} label="Hasil Vector (SVG)" labelClass="bg-indigo-600/80" wheelZoom={full}
          overlay={loading || (!svgResult && <EmptyState icon="vector" text="Hasil vector akan muncul di sini" />)}
        >
          {vectorContent}
        </Pane>
      )),
      bar('bar2'),
    ];
  }

  const btn = 'text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 font-medium transition-all';

  return (
    <div className={full ? 'fixed inset-0 z-50 bg-gray-100 p-3 flex flex-col' : 'flex flex-col'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-indigo-600">3. Preview Hasil</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompareMode(false)}
            className={`${btn} ${!compareMode ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="2" width="18" height="20" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />
            </svg>
            Atas-Bawah
          </button>
          <button
            onClick={() => setCompareMode(true)}
            className={`${btn} ${compareMode ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-indigo-400 text-indigo-600 hover:bg-indigo-50'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
            </svg>
            Perbandingan
          </button>
          <button
            onClick={() => setFull(!full)}
            className={`${btn} bg-white border-gray-200 text-gray-600 hover:border-indigo-400 hover:text-indigo-600`}
            title="Layar penuh (F)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
            {full ? 'Tutup' : 'Layar Penuh'}
          </button>
        </div>
      </div>

      {/* Area preview */}
      <div ref={areaRef} className={full ? 'flex-1 min-h-0 flex flex-col gap-2' : 'flex flex-col'}>
        {body}
      </div>

      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
        <button
          onClick={() => zoomBy(1 / 1.5)}
          disabled={view.z <= MIN_Z}
          className="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
          title="Zoom out (-)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <span className="text-xs text-gray-500 font-medium w-14 text-center tabular-nums">{Math.round(view.z * 100)}%</span>
        <button
          onClick={() => zoomBy(1.5)}
          disabled={view.z >= MAX_Z}
          className="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
          title="Zoom in (+)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button
          onClick={() => setView({ z: 1, x: 0, y: 0 })}
          className="text-xs px-2.5 h-7 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-indigo-400"
          title="Pas ke layar (0)"
        >
          Fit
        </button>
        {[2, 4, 8].map((z) => (
          <button
            key={z}
            onClick={() => setView((v) => ({ z, x: (v.x / v.z) * z, y: (v.y / v.z) * z }))}
            className="text-xs px-2.5 h-7 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-indigo-400"
          >
            {z * 100}%
          </button>
        ))}
        {!full && (
          <button
            onClick={() => setPaneH(null)}
            className={`text-xs px-2.5 h-7 rounded-full border ${paneH === null ? 'border-indigo-400 text-indigo-600 bg-indigo-50' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-400'}`}
            title="Tinggi panel otomatis mengikuti lebar gambar"
          >
            Tinggi otomatis
          </button>
        )}
        <span className="text-[11px] text-gray-400 ml-2">Ctrl + scroll = zoom · drag = geser · double-click = zoom di titik itu · F = layar penuh</span>
      </div>
    </div>
  );
};

export default PreviewPanel;
