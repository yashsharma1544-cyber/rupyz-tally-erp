const sharp = require('sharp');
const fs = require('fs');
const svgRaw = fs.readFileSync('public/icons/icon.svg').toString();

// Strip xml decl and outer <svg ...> tag, leaving just inner content for embedding
const inner = svgRaw
  .replace(/<\?xml[^?]*\?>/, '')
  .replace(/^[\s\n]*<svg[^>]*>/, '')
  .replace(/<\/svg>[\s\n]*$/, '');

// Maskable icon — extra 10% safe-area padding so home-screen mask doesn't clip
const padded = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'>
  <rect width='640' height='640' fill='#0d5b58'/>
  <g transform='translate(64 64)'>
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='512' height='512'>
      ${inner}
    </svg>
  </g>
</svg>
`;

(async () => {
  await sharp(Buffer.from(svgRaw), { density: 300 }).resize(192, 192).png().toFile('public/icons/icon-192.png');
  await sharp(Buffer.from(svgRaw), { density: 300 }).resize(512, 512).png().toFile('public/icons/icon-512.png');
  await sharp(Buffer.from(padded), { density: 300 }).resize(512, 512).png().toFile('public/icons/icon-maskable.png');
  await sharp(Buffer.from(svgRaw), { density: 300 }).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
  await sharp(Buffer.from(svgRaw), { density: 300 }).resize(32, 32).png().toFile('public/icons/favicon.png');
  console.log('done');
})();
