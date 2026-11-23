import React, { useState } from 'react';

const formats = [
  {
    id: 'svg',
    label: 'SVG',
    desc: 'Scalable Vector\nGraphics',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c6fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
        <polyline points="12 22 12 15.5"/>
        <polyline points="22 8.5 12 15.5 2 8.5"/>
      </svg>
    ),
  },
  {
    id: 'eps',
    label: 'EPS',
    desc: 'Encapsulated\nPostScript',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="15" y2="17"/>
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI',
    desc: 'Adobe Illustrator\nFile',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
      </svg>
    ),
  },
];

const ExportPanel = ({ svgResult, originalFileName }) => {
  const [selected, setSelected] = useState('svg');

  const baseName = originalFileName
    ? originalFileName.replace(/\.[^/.]+$/, '')
    : 'vector-result';

  const downloadSVG = () => {
    const blob = new Blob([svgResult], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, `${baseName}.svg`);
  };

  const downloadEPS = () => {
    // EPS header + embedded SVG content as PostScript comment
    const epsContent = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      '%%BoundingBox: 0 0 800 800',
      '%%Title: ' + baseName,
      '%%Creator: Vector Generate',
      '%%EndComments',
      '%%BeginProlog',
      '% SVG data embedded below',
      '%%EndProlog',
      '%%Page: 1 1',
      svgResult,
      '%%EOF',
    ].join('\n');
    const blob = new Blob([epsContent], { type: 'application/postscript' });
    triggerDownload(blob, `${baseName}.eps`);
  };

  const downloadAI = () => {
    // Adobe Illustrator format wraps SVG with AI-compatible header
    const aiContent = [
      '%!PS-Adobe-3.0',
      '%%Creator: Adobe Illustrator',
      '%%Title: ' + baseName,
      '%%BoundingBox: 0 0 800 800',
      '%%EndComments',
      svgResult,
      '%%EOF',
    ].join('\n');
    const blob = new Blob([aiContent], { type: 'application/illustrator' });
    triggerDownload(blob, `${baseName}.ai`);
  };

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    if (!svgResult) return;
    if (selected === 'svg') downloadSVG();
    else if (selected === 'eps') downloadEPS();
    else if (selected === 'ai') downloadAI();
  };

  return (
    <div>
      <h2 className="text-sm font-semibold text-indigo-600 mb-3">5. Export</h2>
      <div className="flex items-stretch gap-3">
        {/* Format selection */}
        <div className="flex gap-2 flex-1">
          {formats.map((fmt) => (
            <button
              key={fmt.id}
              onClick={() => svgResult && setSelected(fmt.id)}
              className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all flex-1 ${
                selected === fmt.id
                  ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              } ${!svgResult ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {fmt.icon}
              <span className={`text-xs font-bold ${selected === fmt.id ? 'text-indigo-700' : 'text-gray-700'}`}>
                {fmt.label}
              </span>
              <span className="text-[10px] text-gray-400 text-center leading-tight whitespace-pre-line">
                {fmt.desc}
              </span>
            </button>
          ))}
        </div>

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={!svgResult}
          className={`flex flex-col items-center justify-center gap-2 px-8 rounded-xl font-semibold text-sm min-w-[130px] transition-all ${
            svgResult
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg cursor-pointer'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Download {selected.toUpperCase()}</span>
        </button>
      </div>
    </div>
  );
};

export default ExportPanel;
