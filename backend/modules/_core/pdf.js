'use strict';

const puppeteer = require('puppeteer');

async function htmlToPdfBuffer(html) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    return buf;
  } finally {
    await browser.close();
  }
}

module.exports = { htmlToPdfBuffer };
