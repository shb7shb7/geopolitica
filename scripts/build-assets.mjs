// Génère public/data/world.json (tracés SVG des pays, projetés une fois pour toutes)
// et copie les drapeaux des nations jouables dans public/flags/.
// Usage : npm run build:assets
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COUNTRIES = require(path.join(root, 'src/data/countries.js'));

const W = 1000, H = 500;
const load = (f) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules/world-atlas', f), 'utf8'));
const t110 = load('countries-110m.json');
const t50 = load('countries-50m.json');
const f110 = feature(t110, t110.objects.countries).features.filter(f => f.id !== '010'); // sans l'Antarctique
const f50 = feature(t50, t50.objects.countries).features;

// Les petits pays absents de la carte 110m (Singapour…) sont pris dans la carte 50m.
const ours = new Set(COUNTRIES.map(c => c.iso));
const have = new Set(f110.map(f => f.id));
const features = [...f110, ...f50.filter(f => ours.has(f.id) && !have.has(f.id))];

const projection = geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'FeatureCollection', features: f110 });
const pathGen = geoPath(projection).digits(1);

function mainCenter(f) {
  const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
  let best = null, bestArea = -1;
  for (const coords of polys) {
    const poly = { type: 'Polygon', coordinates: coords };
    const a = pathGen.area(poly);
    if (a > bestArea) { bestArea = a; best = poly; }
  }
  const [x, y] = pathGen.centroid(best);
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

const out = { w: W, h: H, countries: [], centers: {} };
for (const f of features) {
  const d = pathGen(f);
  if (!d) continue;
  out.countries.push({ iso: f.id, d });
  if (ours.has(f.id)) out.centers[f.id] = mainCenter(f);
}
// Vérifie que chaque nation jouable a bien un centre sur la carte
const missing = [...ours].filter(iso => !out.centers[iso]);
if (missing.length) throw new Error('Pays introuvables sur la carte : ' + missing.join(', '));

fs.mkdirSync(path.join(root, 'public/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/data/world.json'), JSON.stringify(out));
console.log(`world.json : ${out.countries.length} pays, ${(fs.statSync(path.join(root, 'public/data/world.json')).size / 1024).toFixed(0)} Ko`);

fs.mkdirSync(path.join(root, 'public/flags'), { recursive: true });
for (const c of COUNTRIES) {
  fs.copyFileSync(path.join(root, 'node_modules/flag-icons/flags/4x3', `${c.a2}.svg`), path.join(root, 'public/flags', `${c.a2}.svg`));
}
console.log(`${COUNTRIES.length} drapeaux copiés`);
