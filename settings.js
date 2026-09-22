/*
 * settings.js — fenêtre « Paramètres » > rubrique « Mise à jour des PEI »
 * Dépend de pei-update.js (objet global PEIUpdate).
 */
(function () {
  'use strict';

  var dlg = document.getElementById('settings-dialog');
  var openBtn = document.getElementById('settings-open');
  if (!dlg || !openBtn || !window.PEIUpdate) return;

  var closeBtn = document.getElementById('settings-close');
  var dropZone = document.getElementById('maj-drop');
  var pickBtn = document.getElementById('maj-pick');
  var input = document.getElementById('maj-input');
  var filesEl = document.getElementById('maj-files');
  var reportEl = document.getElementById('maj-report');
  var buildBtn = document.getElementById('maj-build');
  var resetBtn = document.getElementById('maj-reset');
  var resultEl = document.getElementById('maj-result');

  var files = [];          // { name, size, modified, rows | null, error | null }
  var lastAnalysis = null; // résultat de PEIUpdate.analyse
  var currentGeo = null;   // contenu actuel de data/hydrants.geojson
  var currentPromise = null;
  var runId = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // ---------- Fichier actuel (data/hydrants.geojson) ----------
  function loadCurrent() {
    if (!currentPromise) {
      currentPromise = fetch('data/hydrants.geojson', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (g) { currentGeo = g; return g; })
        .catch(function () { currentGeo = null; return null; });
    }
    return currentPromise;
  }

  // ---------- Ouverture / fermeture ----------
  openBtn.addEventListener('click', function () {
    if (typeof dlg.showModal !== 'function') {
      alert('Ce navigateur est trop ancien pour cette fonction : utilisez une version récente de Chrome ou Edge.');
      return;
    }
    dlg.showModal();
    loadCurrent();
    closeBtn.blur();
  });
  closeBtn.addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); // clic sur le fond
  dlg.addEventListener('close', reset);

  function reset() {
    files = [];
    lastAnalysis = null;
    currentPromise = null;
    currentGeo = null;
    runId++;
    input.value = '';
    resultEl.hidden = true;
    resultEl.textContent = '';
    render();
  }
  resetBtn.addEventListener('click', function () {
    files = []; lastAnalysis = null; runId++; input.value = '';
    resultEl.hidden = true; resultEl.textContent = '';
    render();
  });

  // ---------- Ajout de fichiers : bouton, glisser-déposer, Ctrl+V ----------
  pickBtn.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dlg.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('over'); });
  });
  dlg.addEventListener('dragleave', function (e) {
    if (e.target === dlg || e.target === dropZone) dropZone.classList.remove('over');
  });
  dlg.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  // Un fichier lâché à côté de la fenêtre ne doit pas être ouvert par le navigateur
  ['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (dlg.open) e.preventDefault(); });
  });
  dlg.addEventListener('paste', function (e) {
    var fl = e.clipboardData && e.clipboardData.files;
    if (fl && fl.length) { e.preventDefault(); addFiles(fl); }
  });

  // Deux exports peuvent porter le même nom : on les distingue à l'affichage
  function uniqueName(name) {
    var n = name, k = 2;
    while (files.some(function (x) { return x.name === n; })) {
      n = name.replace(/(\.[^.]*)?$/, ' (' + k + ')$1');
      k++;
    }
    return n;
  }

  async function addFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList);
    for (var i = 0; i < incoming.length; i++) {
      var f = incoming[i];
      var dup = files.some(function (x) { return x.name === f.name && x.size === f.size && x.modified === f.lastModified; });
      if (dup) continue;
      var entry = { name: uniqueName(f.name), size: f.size, modified: f.lastModified, rows: null, error: null };
      try {
        if (!/\.xlsx$/i.test(f.name)) {
          throw new Error(/\.xls$/i.test(f.name)
            ? 'Format .xls non pris en charge : refaites l\'export vers Excel (.xlsx).'
            : 'Ce fichier n\'est pas un classeur Excel .xlsx.');
        }
        entry.rows = await PEIUpdate.readXlsxRows(await f.arrayBuffer());
      } catch (err) {
        entry.error = err && err.message ? err.message : 'Fichier illisible.';
      }
      files.push(entry);
    }
    resultEl.hidden = true;
    render();
  }

  // ---------- Vérification + affichage ----------
  async function render() {
    var my = ++runId;
    lastAnalysis = null;
    buildBtn.disabled = true;

    // Liste des fichiers
    filesEl.textContent = '';
    files.forEach(function (f, idx) {
      var li = el('li');
      li.appendChild(el('span', 'f-name', f.name));
      li.appendChild(el('span', 'f-kind', '')).hidden = true;
      var rm = el('button', 'f-remove', '✕');
      rm.type = 'button';
      rm.title = 'Retirer ce fichier';
      rm.addEventListener('click', function () {
        files.splice(idx, 1);
        resultEl.hidden = true;
        render();
      });
      li.appendChild(rm);
      filesEl.appendChild(li);
    });
    resetBtn.hidden = files.length === 0;

    reportEl.textContent = '';
    if (files.length === 0) return;

    var checks = [];
    var readErrors = files.filter(function (f) { return f.error; });

    if (readErrors.length) {
      readErrors.forEach(function (f) { checks.push({ level: 'error', title: f.name + ' — ' + f.error }); });
    } else if (files.length === 1) {
      reportEl.appendChild(el('p', 'r-wait', '1 fichier chargé. Il manque le 2e export : déposez-le à son tour.'));
      return;
    } else {
      var current = await loadCurrent();
      if (my !== runId) return; // une autre action a eu lieu entre-temps
      var res = PEIUpdate.analyse(files.map(function (f) { return { name: f.name, rows: f.rows }; }), current);
      lastAnalysis = res;
      checks = res.checks;

      // Nature détectée pour chaque fichier
      Array.prototype.forEach.call(filesEl.children, function (li, i) {
        var kind = res.fileKinds[files[i].name];
        var tag = li.querySelector('.f-kind');
        if (kind) { tag.textContent = kind === 'types' ? 'Types de PEI' : 'Communes'; tag.hidden = false; }
      });
    }

    var hasError = checks.some(function (c) { return c.level === 'error'; });
    var hasWarn = checks.some(function (c) { return c.level === 'warn'; });

    reportEl.appendChild(el('h4', null, hasError ? 'Vérification : à corriger avant de continuer'
      : hasWarn ? 'Vérification : points d\'attention' : 'Vérification : tout est bon'));
    var ul = el('ul');
    checks.forEach(function (c) {
      var li = el('li', 'r-' + c.level);
      li.appendChild(el('span', 'r-icon', c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'));
      var box = el('div');
      box.appendChild(el('div', 'r-title', c.title));
      if (c.detail) box.appendChild(el('div', 'r-detail', c.detail));
      li.appendChild(box);
      ul.appendChild(li);
    });
    reportEl.appendChild(ul);

    buildBtn.disabled = !(lastAnalysis && lastAnalysis.canBuild);
  }

  // ---------- Génération du fichier ----------
  buildBtn.addEventListener('click', function () {
    if (!lastAnalysis || !lastAnalysis.canBuild || !currentGeo) return;
    var built;
    try {
      built = PEIUpdate.buildGeojson(currentGeo, lastAnalysis.features);
    } catch (err) {
      resultEl.hidden = false;
      resultEl.textContent = 'Erreur : ' + err.message;
      return;
    }
    var url = URL.createObjectURL(new Blob([built.text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'hydrants.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

    resultEl.hidden = false;
    resultEl.textContent = '';
    resultEl.appendChild(el('b', null, 'hydrants.geojson généré et téléchargé. '));
    resultEl.appendChild(document.createTextNode(
      built.total.toLocaleString('fr-FR') + ' points au total (' + built.sector.toLocaleString('fr-FR') +
      ' du secteur mis à jour + ' + built.others.toLocaleString('fr-FR') + ' autres conservés). ' +
      'Dernière étape : déposez-le dans le dossier data de GitHub (étape 6).'));
  });

  render();
})();
