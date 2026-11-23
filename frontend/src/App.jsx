import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import Navbar from './components/Navbar';
import UploadPanel from './components/UploadPanel';
import TraceSettings from './components/TraceSettings';
import PreviewPanel from './components/PreviewPanel';
import ExportPanel from './components/ExportPanel';
import AutoTraceInfo from './components/AutoTraceInfo';
import OutputSizeSelector from './components/OutputSizeSelector';
import BundleEditor from './components/BundleEditor';
import { getAllItems, putItem, deleteItem, newItemId } from './utils/bundleStore';

const API_BASE = 'http://localhost:3001';

const defaultSettings = {
  mode: 'multicolor',
  colors: 16,
  detail: 75,
  pathSmoothing: 70,
  noiseFilter: 25,
  threshold: 50,
};

function App() {
  const [file, setFile] = useState(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [svgResult, setSvgResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [traceMode, setTraceMode] = useState('auto'); // 'auto' | 'manual'
  const [detectedPreset, setDetectedPreset] = useState(null);
  const [outputSize, setOutputSize] = useState('0'); // px string; '0' = original

  // ── Bundle ──────────────────────────────────────────────────────────────
  const [page, setPage] = useState('trace'); // 'trace' | 'bundle'
  const [bundleItems, setBundleItems] = useState([]);
  const [toast, setToast] = useState(null);

  // koleksi bundle disimpan di browser (IndexedDB) -> tidak hilang saat refresh
  useEffect(() => { getAllItems().then(setBundleItems).catch(() => {}); }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const addBundleItem = async (name, svg) => {
    const item = { id: newItemId(), name, svg, createdAt: Date.now() };
    await putItem(item);
    setBundleItems((list) => [...list, item]);
  };

  const handleAddToBundle = async () => {
    if (!svgResult) return;
    const base = file?.name ? file.name.replace(/\.[^/.]+$/, '') : 'vector';
    const n = bundleItems.filter((i) => i.name === base || i.name.startsWith(`${base} (`)).length;
    await addBundleItem(n ? `${base} (${n + 1})` : base, svgResult);
    showToast(`✓ Masuk ke Bundle (${bundleItems.length + 1} vector)`);
  };

  const handleAddSvgFiles = async (files) => {
    let ok = 0;
    for (const f of files) {
      const text = await f.text();
      if (text.includes('<svg')) {
        await addBundleItem(f.name.replace(/\.svg$/i, ''), text);
        ok += 1;
      }
    }
    showToast(ok ? `✓ ${ok} file SVG ditambahkan` : 'File bukan SVG');
  };

  const handleRenameItem = async (id, name) => {
    const item = bundleItems.find((i) => i.id === id);
    if (!item) return;
    const next = { ...item, name };
    await putItem(next);
    setBundleItems((list) => list.map((i) => (i.id === id ? next : i)));
  };

  const handleDeleteItem = async (id) => {
    await deleteItem(id);
    setBundleItems((list) => list.filter((i) => i.id !== id));
  };

  const handleFileChange = useCallback((newFile) => {
    setFile(newFile);
    setSvgResult(null);
    setError(null);
    setDetectedPreset(null);

    // In auto mode: trigger trace immediately after file is selected
    if (traceMode === 'auto') {
      runAutoTrace(newFile);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceMode, outputSize]);

  const handleFileRemove = useCallback(() => {
    setFile(null);
    setSvgResult(null);
    setError(null);
    setDetectedPreset(null);
  }, []);

  const handleSettingChange = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Auto Trace ──────────────────────────────────────────────────────────
  const runAutoTrace = async (targetFile) => {
    if (!targetFile) return;

    setIsLoading(true);
    setError(null);
    setSvgResult(null);
    setDetectedPreset(null);

    const formData = new FormData();
    formData.append('image', targetFile);
    formData.append('outputSize', outputSize);

    try {
      const res = await axios.post(`${API_BASE}/api/auto-trace`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });
      setSvgResult(res.data.svg);
      if (res.data.preset) {
        setDetectedPreset(res.data.preset);
        // Sync the manual sliders with the detected preset so user can
        // fine-tune from a good starting point if they want.
        setSettings({
          mode          : res.data.preset.mode          ?? defaultSettings.mode,
          colors        : res.data.preset.colors        ?? defaultSettings.colors,
          detail        : res.data.preset.detail        ?? defaultSettings.detail,
          pathSmoothing : res.data.preset.smoothing     ?? defaultSettings.pathSmoothing,
          noiseFilter   : res.data.preset.noise         ?? defaultSettings.noiseFilter,
          threshold     : res.data.preset.threshold     ?? defaultSettings.threshold,
        });
      }
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.error || err.message || 'Terjadi kesalahan saat memproses.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Manual Trace ─────────────────────────────────────────────────────────
  const handleTrace = async () => {
    if (!file) {
      setError('Pilih gambar terlebih dahulu.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSvgResult(null);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('mode', settings.mode);
    formData.append('colors', settings.colors);
    formData.append('detail', settings.detail);
    formData.append('pathSmoothing', settings.pathSmoothing);
    formData.append('noiseFilter', settings.noiseFilter);
    formData.append('threshold', settings.threshold);
    formData.append('outputSize', outputSize);

    try {
      const res = await axios.post(`${API_BASE}/api/trace`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setSvgResult(res.data.svg);
      setDetectedPreset(null);
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.error || err.message || 'Terjadi kesalahan saat memproses.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = useCallback(() => {
    setFile(null);
    setSvgResult(null);
    setError(null);
    setSettings(defaultSettings);
    setDetectedPreset(null);
    setOutputSize('0');
  }, []);

  const handleModeSwitch = (mode) => {
    setTraceMode(mode);
    setSvgResult(null);
    setError(null);
    setDetectedPreset(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-[1700px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-5">
        {/* ── Tab halaman ── */}
        <div className="flex items-center gap-1 mb-4">
          {[
            ['trace', 'Tracing'],
            ['bundle', `Bundle${bundleItems.length ? ` (${bundleItems.length})` : ''}`],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                page === id ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {page === 'bundle' ? (
          <BundleEditor
            items={bundleItems}
            onRename={handleRenameItem}
            onDelete={handleDeleteItem}
            onAddSvgFiles={handleAddSvgFiles}
          />
        ) : (
        <div className="flex gap-5 items-start">

          {/* ── Left sidebar (menempel saat halaman di-scroll) ── */}
          <div className="w-64 flex-shrink-0 sticky top-3">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col max-h-[calc(100vh-1.5rem)] overflow-y-auto">

              {/* Mode toggle */}
              <div className="mb-5">
                <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => handleModeSwitch('auto')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-all ${
                      traceMode === 'auto'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                      <path d="M2 17l10 5 10-5"/>
                      <path d="M2 12l10 5 10-5"/>
                    </svg>
                    Auto
                  </button>
                  <button
                    onClick={() => handleModeSwitch('manual')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-all ${
                      traceMode === 'manual'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                    </svg>
                    Manual
                  </button>
                </div>
                {traceMode === 'auto' && (
                  <p className="text-[10px] text-indigo-500 text-center mt-1.5 font-medium">
                    ✦ Upload gambar → langsung di-trace otomatis
                  </p>
                )}
              </div>

              <UploadPanel
                file={file}
                onFileChange={handleFileChange}
                onFileRemove={handleFileRemove}
              />

              {/* Auto mode: show detected preset info */}
              {traceMode === 'auto' && (
                <AutoTraceInfo
                  detectedPreset={detectedPreset}
                  isLoading={isLoading}
                  hasFile={!!file}
                  onRetrace={() => runAutoTrace(file)}
                />
              )}

              {/* Manual mode: show settings + trace button */}
              {traceMode === 'manual' && (
                <>
                  <TraceSettings settings={settings} onChange={handleSettingChange} />

                  {error && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs text-red-600 font-medium">⚠ {error}</p>
                    </div>
                  )}

                  <div className="mt-4">
                    <button
                      onClick={handleTrace}
                      disabled={!file || isLoading}
                      className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                        file && !isLoading
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg cursor-pointer'
                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {isLoading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Memproses...
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/>
                          </svg>
                          Trace Gambar
                        </>
                      )}
                    </button>

                    {(file || svgResult) && (
                      <button
                        onClick={handleReset}
                        className="w-full mt-2 py-2 rounded-xl text-xs text-gray-500 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all"
                      >
                        Reset semua
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Auto mode: error + reset */}
              {traceMode === 'auto' && (
                <>
                  {error && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs text-red-600 font-medium">⚠ {error}</p>
                    </div>
                  )}
                  {(file || svgResult) && (
                    <button
                      onClick={handleReset}
                      className="w-full mt-3 py-2 rounded-xl text-xs text-gray-500 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all"
                    >
                      Reset semua
                    </button>
                  )}
                </>
              )}

            </div>
          </div>

          {/* ── Main content ── */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            {/* Preview */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col">
              <PreviewPanel
                originalFile={file}
                svgResult={svgResult}
                isLoading={isLoading}
              />
            </div>

            {/* Export */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <div className="mb-4 pb-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-indigo-600 mb-3">4. Ukuran Output</h2>
                <OutputSizeSelector value={outputSize} onChange={setOutputSize} />
              </div>
              <ExportPanel svgResult={svgResult} originalFileName={file?.name} />
              <button
                onClick={handleAddToBundle}
                disabled={!svgResult}
                className={`w-full mt-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                  svgResult
                    ? 'border-indigo-500 text-indigo-700 hover:bg-indigo-50'
                    : 'border-gray-200 text-gray-300 cursor-not-allowed'
                }`}
              >
                + Masukkan ke Bundle
              </button>
            </div>
          </div>

        </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
