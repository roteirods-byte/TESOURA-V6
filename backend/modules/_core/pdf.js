const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function htmlToPdfBuffer(html) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tesoura-pdf-'));
  const htmlPath = path.join(tmp, 'doc.html');
  const pdfPath = path.join(tmp, 'doc.pdf');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const fileUrl = 'file://' + htmlPath;

  const chromeCandidates = [
    process.env.CHROME_BIN,
    'chromium-browser',
    'chromium',
    'google-chrome',
    'google-chrome-stable'
  ].filter(Boolean);

  let lastErr = null;

  for (const bin of chromeCandidates) {
    try {
      await execFileP(bin, [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--print-to-pdf=${pdfPath}`,
        fileUrl
      ]);
      if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1000) {
        const buf = fs.readFileSync(pdfPath);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        return buf;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // fallback: wkhtmltopdf (se existir)
  try {
    await execFileP('wkhtmltopdf', [htmlPath, pdfPath]);
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1000) {
      const buf = fs.readFileSync(pdfPath);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      return buf;
    }
  } catch (e) {
    lastErr = lastErr || e;
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  const msg = (lastErr && (lastErr.stderr || lastErr.message)) ? String(lastErr.stderr || lastErr.message) : 'Falha ao gerar PDF (chromium/wkhtmltopdf não disponíveis)';
  throw new Error(msg);
}

module.exports = { htmlToPdfBuffer };
