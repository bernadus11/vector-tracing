// Export helper dipakai oleh ExportPanel (hasil trace) dan BundleEditor.
// Format EPS/AI sama persis dengan versi sebelumnya, hanya BoundingBox
// sekarang mengikuti ukuran SVG (dulu selalu 800x800).

export function svgSize(svg) {
  const head = (svg.match(/<svg[^>]*>/) || [''])[0];
  const w = parseFloat((head.match(/\swidth="([\d.]+)/) || [])[1]);
  const h = parseFloat((head.match(/\sheight="([\d.]+)/) || [])[1]);
  if (w > 0 && h > 0) return { w, h };
  const vb = (head.match(/viewBox="([^"]+)"/) || [])[1];
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] };
  }
  return { w: 800, h: 800 };
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSVG(svg, baseName) {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`);
}

export function downloadEPS(svg, baseName) {
  const { w, h } = svgSize(svg);
  const epsContent = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.round(w)} ${Math.round(h)}`,
    '%%Title: ' + baseName,
    '%%Creator: Vector Generate',
    '%%EndComments',
    '%%BeginProlog',
    '% SVG data embedded below',
    '%%EndProlog',
    '%%Page: 1 1',
    svg,
    '%%EOF',
  ].join('\n');
  triggerDownload(new Blob([epsContent], { type: 'application/postscript' }), `${baseName}.eps`);
}

export function downloadAI(svg, baseName) {
  const { w, h } = svgSize(svg);
  const aiContent = [
    '%!PS-Adobe-3.0',
    '%%Creator: Adobe Illustrator',
    '%%Title: ' + baseName,
    `%%BoundingBox: 0 0 ${Math.round(w)} ${Math.round(h)}`,
    '%%EndComments',
    svg,
    '%%EOF',
  ].join('\n');
  triggerDownload(new Blob([aiContent], { type: 'application/illustrator' }), `${baseName}.ai`);
}

/** Render SVG ke PNG/JPG (ukuran = ukuran frame, maks 10000px). */
export function downloadRaster(svg, baseName, type = 'png', background = null) {
  const { w, h } = svgSize(svg);
  const k = Math.min(1, 10000 / Math.max(w, h));
  const cw = Math.round(w * k);
  const ch = Math.round(h * k);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (type === 'jpg' || background) {
        ctx.fillStyle = background || '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Gagal membuat gambar')); return; }
        triggerDownload(blob, `${baseName}.${type}`);
        resolve();
      }, type === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG tidak bisa dirender')); };
    img.src = url;
  });
}

export function downloadAs(format, svg, baseName) {
  if (!svg) return;
  if (format === 'png' || format === 'jpg') { downloadRaster(svg, baseName, format); return; }
  if (format === 'eps') downloadEPS(svg, baseName);
  else if (format === 'ai') downloadAI(svg, baseName);
  else downloadSVG(svg, baseName);
}
