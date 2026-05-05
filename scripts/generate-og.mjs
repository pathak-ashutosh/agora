import sharp from 'sharp';

const W = 1200;
const H = 630;

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="80" y="220" font-family="system-ui, sans-serif" font-size="72" font-weight="700" fill="#e2e8f0">agora</text>
  <text x="80" y="310" font-family="system-ui, sans-serif" font-size="32" font-weight="400" fill="#94a3b8">U.S. Congressional Caucus Network Explorer</text>
  <line x1="80" y1="360" x2="480" y2="360" stroke="#6366f1" stroke-width="3" stroke-linecap="round"/>
  <text x="80" y="440" font-family="system-ui, sans-serif" font-size="22" fill="#64748b">Visualize &amp; analyze bipartisan<br/>connections across Congress</text>
  <circle cx="${W - 200}" cy="${H / 2}" r="120" fill="none" stroke="#6366f1" stroke-width="1.5" opacity="0.4"/>
  <circle cx="${W - 200}" cy="${H / 2}" r="80" fill="none" stroke="#818cf8" stroke-width="1" opacity="0.3"/>
  <circle cx="${W - 200}" cy="${H / 2}" r="40" fill="#6366f1" opacity="0.5"/>
  <line x1="${W - 200}" y1="${H / 2 - 120}" x2="${W - 200}" y2="${H / 2 + 120}" stroke="#475569" stroke-width="0.5" opacity="0.3"/>
  <line x1="${W - 320}" y1="${H / 2}" x2="${W - 80}" y2="${H / 2}" stroke="#475569" stroke-width="0.5" opacity="0.3"/>
</svg>`;

await sharp(Buffer.from(svg))
  .png()
  .toFile('public/og.png');

console.log('OG image generated → public/og.png');
