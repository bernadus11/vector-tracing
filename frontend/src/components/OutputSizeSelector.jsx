/**
 * OutputSizeSelector.jsx
 * Dropdown to pick the output SVG canvas size (longest edge in px).
 * Used in both Auto and Manual trace modes.
 *
 * The selected value is passed to the backend via outputSize form field.
 * "0" means "keep original size" — the SVG will be whatever vtracer produced.
 */

const PRESETS = [
  { value: '0',    label: 'Original (bawaan)' },
  { value: '4000', label: '4000 px — Microstock HD' },
  { value: '3000', label: '3000 px — Microstock Standard' },
  { value: '2000', label: '2000 px — Web / Medium' },
  { value: '1500', label: '1500 px — Thumbnail / Small' },
  { value: '1000', label: '1000 px — Icon / UI' },
];

const OutputSizeSelector = ({ value, onChange }) => {
  const isCustom = !PRESETS.find((p) => p.value === value);

  return (
    <div className="mb-0">
      <label className="text-xs text-gray-700 font-medium block mb-1">
        Ukuran Output
        <span className="ml-1 text-[10px] text-gray-400 font-normal">
          (sisi terpanjang)
        </span>
      </label>

      <div className="relative">
        <select
          value={isCustom ? 'custom' : value}
          onChange={(e) => {
            if (e.target.value === 'custom') return; // handled by input below
            onChange(e.target.value);
          }}
          className="w-full border border-gray-200 rounded-lg py-2 pl-3 pr-8 text-xs text-gray-700 bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="custom" disabled={!isCustom}>
            Custom...
          </option>
        </select>
        <svg
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Custom px input — shown only when a non-preset value is active */}
      {isCustom && (
        <input
          type="number"
          min="100"
          max="10000"
          step="100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="misal: 5000"
          className="mt-1 w-full border border-indigo-300 rounded-lg py-1.5 px-3 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      )}

      {value !== '0' && (
        <p className="mt-1 text-[10px] text-indigo-500">
          ✦ Output SVG akan di-set ke <strong>{value} px</strong> sisi terpanjang, aspect ratio dipertahankan.
        </p>
      )}
    </div>
  );
};

export default OutputSizeSelector;
