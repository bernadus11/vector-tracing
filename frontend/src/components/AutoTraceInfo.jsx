/**
 * AutoTraceInfo.jsx
 * Shows the auto-detected preset parameters and a "Re-trace" button.
 * Displayed only in Auto mode on the left sidebar.
 */

const modeLabel = {
  multicolor: '🎨 Multi Color',
  grayscale : '⬜ Grayscale',
  blackwhite: '◼ Hitam Putih',
};

const AutoTraceInfo = ({ detectedPreset, isLoading, hasFile, onRetrace }) => {
  if (!hasFile && !isLoading) {
    return (
      <div className="mt-5 p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b4fcf" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-indigo-700 mb-1">Mode Otomatis</p>
            <p className="text-[11px] text-indigo-500 leading-relaxed">
              Upload gambar dan sistem akan menganalisis lalu men-trace secara otomatis — seperti Vector Magic.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-5 p-4 rounded-xl bg-indigo-50 border border-indigo-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin flex-shrink-0" />
          <p className="text-xs font-semibold text-indigo-700">Menganalisis gambar...</p>
        </div>
        <div className="space-y-1.5">
          {['Mendeteksi warna dominan', 'Menghitung kompleksitas', 'Memilih preset optimal', 'Memproses vector'].map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
              <span className="text-[11px] text-indigo-400">{step}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!detectedPreset) return null;

  return (
    <div className="mt-5">
      {/* Detected preset badge */}
      <div className="p-3 rounded-xl bg-green-50 border border-green-200 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span className="text-xs font-semibold text-green-700">Preset Terdeteksi Otomatis</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <PresetRow label="Mode" value={modeLabel[detectedPreset.mode] ?? detectedPreset.mode} />
          {detectedPreset.mode === 'multicolor' && (
            <PresetRow label="Warna" value={`${detectedPreset.colors}`} />
          )}
          <PresetRow label="Detail" value={`${detectedPreset.detail}%`} />
          <PresetRow label="Smoothing" value={`${detectedPreset.smoothing}%`} />
          <PresetRow label="Noise" value={`${detectedPreset.noise}%`} />
        </div>
      </div>

      {/* Re-trace button */}
      <button
        onClick={onRetrace}
        className="w-full py-2 rounded-xl text-xs font-semibold text-indigo-600 border border-indigo-300 hover:bg-indigo-50 transition-all flex items-center justify-center gap-1.5"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Trace Ulang Otomatis
      </button>
    </div>
  );
};

const PresetRow = ({ label, value }) => (
  <div className="flex justify-between items-center">
    <span className="text-[10px] text-gray-500">{label}</span>
    <span className="text-[10px] font-semibold text-gray-700">{value}</span>
  </div>
);

export default AutoTraceInfo;
