'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./src/game');
const attachSockets = require('./src/sockets');
const persistence = require('./src/persistence');

const PORT = process.env.PORT || 3000;
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json');

// PIN MJ : à définir via la variable d'environnement MJ_PIN (sinon un PIN aléatoire est généré à chaque démarrage).
let MJ_PIN = String(process.env.MJ_PIN || '').trim();
if (!MJ_PIN) {
  MJ_PIN = String(crypto.randomInt(100000, 1000000));
  console.log('\n══════════════════════════════════════════');
  console.log(`  PIN MJ (aléatoire) : ${MJ_PIN}`);
  console.log('  Définissez MJ_PIN pour un PIN fixe.');
  console.log('══════════════════════════════════════════\n');
}

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 60000, pingInterval: 25000, maxHttpBufferSize: 1e5 });

const pub = path.join(__dirname, 'public');
app.use('/media', express.static(path.join(pub, 'media'), { maxAge: '7d' }));
app.use(express.static(pub, { maxAge: '5m' }));
app.get('/mj', (req, res) => res.sendFile(path.join(pub, 'mj.html')));
app.get('/screen', (req, res) => res.sendFile(path.join(pub, 'screen.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

const game = new Game();

// QR code affiché sur l'écran de projection : ouvre la page joueur avec le code pré-rempli
app.get('/qr.svg', async (req, res) => {
  const code = game.state.phase === 'draft' ? game.state.sessionCode : '';
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  const url = `${proto}://${req.get('host')}/${code ? `?code=${code}` : ''}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b0f16', light: '#ffffff' } });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});
const saved = persistence.load(STATE_FILE);
if (saved && game.load(saved)) console.log(`Partie restaurée (phase : ${game.state.phase}${game.state.paused ? ', en pause' : ''})`);

const saver = persistence.createSaver(STATE_FILE, () => game.serialize());
const { broadcast } = attachSockets(io, game, { mjPin: MJ_PIN });
const onChange = game.onChange;
game.onChange = () => { onChange(); saver.schedule(); };

setInterval(() => game.tick(), 1000);

const shutdown = () => { saver.flush(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`Geopolitica sur http://localhost:${PORT}  ·  MJ : /mj  ·  Écran : /screen`);
  broadcast();
});
