import React, { useState } from 'react';

const Tooltip = ({ text }) => (
  <span className="relative group inline-flex ml-1">
    <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px] flex items-center justify-center cursor-help font-bold">?</span>
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50 shadow-lg">
      {text}
    </span>
  </span>
);

const SliderRow = ({ label, tooltip, min, max, value, onChange, unit = '' }) => (
  <div className="mb-4">
    <div className="flex items-center justify-between mb-1">
      <label className="text-xs text-gray-700 font-medium flex items-center">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </label>
      <span className="text-xs text-gray-500 font-medium w-10 text-right">
        {value}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full"
      style={{
        background: `linear-gradient(to right, #5b4fcf ${((value - min) / (max - min)) * 100}%, #e2e1f0 ${((value - min) / (max - min)) * 100}%)`
      }}
    />
  </div>
);

const TraceSettings = ({ settings, onChange }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const modeOptions = [
    { value: 'multicolor', label: 'Multi Color', icon: '🎨' },
    { value: 'grayscale', label: 'Grayscale', icon: '⬜' },
    { value: 'blackwhite', label: 'Hitam Putih', icon: '◼' },
  ];

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-indigo-600 mb-4">2. Pengaturan Trace</h2>

      {/* Mode */}
      <div className="mb-4">
        <label className="text-xs text-gray-700 font-medium flex items-center mb-1">
          Mode
          <Tooltip text="Mode warna hasil vector" />
        </label>
        <div className="relative">
          <select
            value={settings.mode}
            onChange={(e) => onChange('mode', e.target.value)}
            className="w-full border border-gray-200 rounded-lg py-2 pl-3 pr-8 text-sm text-gray-700 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          >
            {modeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      {/* Colors (only for multicolor) */}
      {settings.mode === 'multicolor' && (
        <SliderRow
          label="Jumlah Warna"
          tooltip="Jumlah warna yang akan digunakan dalam hasil vector"
          min={2}
          max={32}
          value={settings.colors}
          onChange={(v) => onChange('colors', v)}
        />
      )}

      {/* Detail */}
      <SliderRow
        label="Detail"
        tooltip="Tingkat detail dan resolusi hasil trace"
        min={10}
        max={100}
        value={settings.detail}
        onChange={(v) => onChange('detail', v)}
        unit="%"
      />

      {/* Path Smoothing */}
      <SliderRow
        label="Path Smoothing"
        tooltip="Kelancaran kurva pada jalur vector"
        min={0}
        max={100}
        value={settings.pathSmoothing}
        onChange={(v) => onChange('pathSmoothing', v)}
        unit="%"
      />

      {/* Noise Filter */}
      <SliderRow
        label="Noise Filter"
        tooltip="Kurangi noise/detail kecil sebelum diproses"
        min={0}
        max={100}
        value={settings.noiseFilter}
        onChange={(v) => onChange('noiseFilter', v)}
        unit="%"
      />

      {/* Threshold */}
      <SliderRow
        label="Threshold"
        tooltip="Batas kecerahan untuk pemisahan area"
        min={0}
        max={100}
        value={settings.threshold}
        onChange={(v) => onChange('threshold', v)}
        unit="%"
      />

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center justify-between w-full text-sm text-gray-600 font-medium py-2 border-t border-gray-100 hover:text-indigo-600"
      >
        <span>Advanced Options</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {showAdvanced && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
          <p className="text-xs text-gray-600 font-medium">Tips pengaturan:</p>
          <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
            <li>Foto kompleks → Jumlah Warna 16–24</li>
            <li>Ilustrasi flat → Jumlah Warna 8–12</li>
            <li>Gambar blur → naikkan Detail, turunkan Noise Filter</li>
            <li>Terlalu banyak detail kecil → naikkan Noise Filter</li>
            <li>Garis kasar → naikkan Path Smoothing</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default TraceSettings;
