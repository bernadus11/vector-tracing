const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

const app  = express();
const PORT = 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// ─── Upload dir ───────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename   : (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits    : { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/png','image/jpg','image/jpeg','image/webp'];
    ok.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Format tidak didukung. Gunakan PNG, JPG, JPEG, atau WEBP.'));
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────
function safeUnlink(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// Detect python command (python or python3)
function getPythonBin() {
  return process.env.PYTHON_BIN || 'python';
}

const WORKER_PATH = path.join(__dirname, 'trace_worker.py');

function runPythonWorker(inputPath, outputPath, opts) {
  return new Promise((resolve, reject) => {
    const pythonBin = getPythonBin();
    const args = [
      WORKER_PATH,
      inputPath,
      outputPath,
      '--mode',        opts.mode,
      '--colors',      String(opts.colors),
      '--detail',      String(opts.detail),
      '--smoothing',   String(opts.pathSmoothing),
      '--noise',       String(opts.noiseFilter),
      '--threshold',   String(opts.threshold),
      '--output-size', String(opts.outputSize || 0),
    ];

    console.log(`[trace] ${pythonBin} ${args.slice(2).join(' ')}`);

    const proc = spawn(pythonBin, args, { cwd: __dirname });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write('[py] ' + d.toString());
    });

    proc.on('error', (err) => {
      reject(new Error(
        `Tidak bisa menjalankan Python ("${pythonBin}"). ` +
        `Pastikan Python sudah terinstall dan ada di PATH. Detail: ${err.message}`
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `trace_worker.py keluar dengan kode ${code}`;
        reject(new Error(msg));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function runPythonWorkerAuto(inputPath, outputPath, outputSize) {
  return new Promise((resolve, reject) => {
    const pythonBin = getPythonBin();
    const args = [
      WORKER_PATH, inputPath, outputPath, '--auto',
      '--output-size', String(outputSize || 0),
    ];

    console.log(`[auto-trace] ${pythonBin} ${args.slice(2).join(' ')}`);

    const proc = spawn(pythonBin, args, { cwd: __dirname });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write('[py-auto] ' + d.toString());
    });

    proc.on('error', (err) => {
      reject(new Error(
        `Tidak bisa menjalankan Python ("${pythonBin}"). ` +
        `Pastikan Python sudah terinstall dan ada di PATH. Detail: ${err.message}`
      ));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `trace_worker.py keluar dengan kode ${code}`;
        reject(new Error(msg));
      } else {
        // stdout may contain a JSON line with the detected preset
        let preset = null;
        try {
          const jsonLine = stdout.trim().split('\n').find(l => l.trim().startsWith('{'));
          if (jsonLine) {
            const parsed = JSON.parse(jsonLine);
            preset = parsed.preset || null;
          }
        } catch {}
        resolve({ preset });
      }
    });
  });
}

// ─── POST /api/trace ──────────────────────────────────────────────────────
app.post('/api/trace', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return next(err);
    handleTrace(req, res);
  });
});

async function handleTrace(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file diupload.' });
  }

  const inputPath  = req.file.path;
  const outputPath = inputPath + '_out.svg';
  const procPath   = inputPath + '_proc.png';
  const procBwPath = procPath + '_bw.png';

  try {
    const {
      mode          = 'multicolor',
      colors        = '16',
      detail        = '80',
      pathSmoothing = '80',
      noiseFilter   = '20',
      threshold     = '50',
      outputSize    = '0',
    } = req.body;

    const opts = {
      mode,
      colors       : Math.min(Math.max(parseInt(colors)        || 16, 2), 32),
      detail       : Math.min(Math.max(parseInt(detail)        || 80, 10), 100),
      pathSmoothing: Math.min(Math.max(parseInt(pathSmoothing) || 80, 0), 100),
      noiseFilter  : Math.min(Math.max(parseInt(noiseFilter)   || 20, 0), 100),
      threshold    : Math.min(Math.max(parseInt(threshold)     || 50, 1), 99),
      outputSize   : Math.max(parseInt(outputSize) || 0, 0),
    };

    await runPythonWorker(inputPath, outputPath, opts);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Worker selesai tapi tidak menghasilkan file SVG.');
    }

    const svgContent = fs.readFileSync(outputPath, 'utf8');
    if (!svgContent.includes('<svg')) {
      throw new Error('Output tidak valid (bukan SVG).');
    }

    safeUnlink(inputPath, outputPath, procPath, procBwPath);
    return res.json({ svg: svgContent });

  } catch (err) {
    console.error('[trace error]', err.message);
    safeUnlink(inputPath, outputPath, procPath, procBwPath);
    return res.status(500).json({
      error: err.message || 'Gagal memproses gambar.'
    });
  }
}

// ─── POST /api/auto-trace ─────────────────────────────────────────────────
// Fully automatic tracing: analyzes image and picks optimal parameters.
// Returns { svg, preset } so frontend can show what settings were used.
app.post('/api/auto-trace', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return next(err);
    handleAutoTrace(req, res);
  });
});

async function handleAutoTrace(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file diupload.' });
  }

  const inputPath  = req.file.path;
  const outputPath = inputPath + '_out.svg';
  const procPath   = inputPath + '_proc.png';
  const procBwPath = procPath + '_bw.png';

  try {
    const { outputSize = '0' } = req.body;
    const outputSizePx = Math.max(parseInt(outputSize) || 0, 0);
    const { preset } = await runPythonWorkerAuto(inputPath, outputPath, outputSizePx);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Worker selesai tapi tidak menghasilkan file SVG.');
    }

    const svgContent = fs.readFileSync(outputPath, 'utf8');
    if (!svgContent.includes('<svg')) {
      throw new Error('Output tidak valid (bukan SVG).');
    }

    safeUnlink(inputPath, outputPath, procPath, procBwPath);
    return res.json({ svg: svgContent, preset });

  } catch (err) {
    console.error('[auto-trace error]', err.message);
    safeUnlink(inputPath, outputPath, procPath, procBwPath);
    return res.status(500).json({
      error: err.message || 'Gagal memproses gambar (auto-trace).'
    });
  }
}

// ─── Health ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', python: getPythonBin() });
});

// ─── Global error handler (Multer + others) ───────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[global error]', err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload error: ' + err.message });
  }
  return res.status(400).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅  Backend berjalan di http://localhost:${PORT}`);
  console.log(`   Python: ${getPythonBin()}`);
  console.log(`   Worker: ${WORKER_PATH}`);
});
