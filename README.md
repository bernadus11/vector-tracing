# Vector Generate - Image to Vector

Website untuk mengkonversi gambar (PNG, JPG, JPEG, WEBP) menjadi file vector (SVG).

## Struktur Folder

```
vector-generate/
├── backend/         → Node.js Express API
│   ├── server.js
│   └── package.json
└── frontend/        → React + Vite
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── Navbar.jsx
    │   │   ├── UploadPanel.jsx
    │   │   ├── TraceSettings.jsx
    │   │   ├── PreviewPanel.jsx
    │   │   └── ExportPanel.jsx
    │   └── index.css
    └── package.json
```

## Cara Menjalankan

### 1. Backend (Terminal 1)
```bash
cd backend
npm start
# Server berjalan di http://localhost:3001
```

### 2. Frontend (Terminal 2)
```bash
cd frontend
npm run dev
# App berjalan di http://localhost:5173
```

## Fitur
- Upload gambar via drag & drop atau klik
- 3 mode trace: Multi Color, Grayscale, Hitam Putih
- Pengaturan: Jumlah Warna, Detail, Path Smoothing, Noise Filter, Threshold
- Preview side-by-side (original vs vector)
- Mode perbandingan dengan slider interaktif
- Zoom preview (25% - 300%)
- Export: SVG, PNG, PDF, EPS, AI
