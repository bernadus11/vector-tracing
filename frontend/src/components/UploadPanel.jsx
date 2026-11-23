import React, { useRef, useState } from 'react';

const UploadPanel = ({ file, onFileChange, onFileRemove }) => {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFileChange(dropped);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleInputChange = (e) => {
    const selected = e.target.files[0];
    if (selected) onFileChange(selected);
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getThumb = () => {
    if (!file) return null;
    return URL.createObjectURL(file);
  };

  return (
    <div>
      <h2 className="text-sm font-semibold text-indigo-600 mb-3">1. Upload Gambar</h2>

      {/* Drop zone */}
      <div
        onClick={() => !file && inputRef.current.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50'
            : file
            ? 'border-green-300 bg-green-50 cursor-default'
            : 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50'
        }`}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2 w-full">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p className="text-sm text-green-600 font-medium">Gambar berhasil dipilih</p>
            <p className="text-xs text-gray-400">Klik untuk ganti gambar</p>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b4fcf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
            </div>
            <p className="text-sm text-gray-600 text-center font-medium">
              Drag &amp; drop gambar di sini
            </p>
            <p className="text-xs text-gray-400 text-center mt-1">
              atau klik untuk upload
            </p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, JPEG, WEBP (Max 10MB)</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* File info row */}
      {file && (
        <div className="mt-3 flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          {/* Thumbnail */}
          <div className="w-10 h-10 rounded overflow-hidden bg-gray-200 flex-shrink-0">
            <img
              src={getThumb()}
              alt="preview"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 truncate">{file.name}</p>
            <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onFileRemove(); }}
            className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadPanel;
