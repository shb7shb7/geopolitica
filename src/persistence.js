'use strict';
const fs = require('fs');
const path = require('path');

// Sauvegarde l'état dans un fichier JSON (écriture atomique, au plus une fois par seconde)
// pour survivre à un redémarrage du serveur en pleine partie.
function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Sauvegarde illisible, nouvelle partie :', err.message);
    return null;
  }
}

function createSaver(file, getData) {
  let timer = null;
  const write = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(getData()));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('Échec de la sauvegarde :', err.message);
    }
  };
  return {
    schedule() { if (!timer) timer = setTimeout(write, 1000); },
    flush() { if (timer) { clearTimeout(timer); } write(); },
  };
}

module.exports = { load, createSaver };
