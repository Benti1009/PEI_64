/*
 * pei-update.js — logique de la rubrique « Mise à jour des PEI »
 *
 * Tout se passe dans le navigateur : les fichiers Excel ne sont envoyés nulle part.
 *  1. lecture des .xlsx (sans bibliothèque : zip + XML natifs du navigateur)
 *  2. vérification des deux exports (communes / types)
 *  3. conversion Lambert 93 -> WGS84
 *  4. reconstruction de data/hydrants.geojson (les points du secteur sont remplacés,
 *     tous les autres points du fichier actuel sont conservés tels quels)
 *
 * Convention : un point du « secteur » est un point qui porte les propriétés x / y
 * (coordonnées Lambert 93 d'origine). Les autres points (type « Autre », commune = code INSEE)
 * ne sont jamais modifiés.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PEIUpdate = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------

  // Libellé de l'export Escort -> libellé utilisé dans l'appli (couleurs, filtres)
  var TYPE_MAP = {
    'POTEAU INCENDIE NORMALISE 60 M': 'Poteau incendie 60 m³/h',
    'POTEAU INCENDIE NORMALISE 30 M': 'Poteau incendie 30 m³/h',
    'BOUCHE INCENDIE': 'Bouche incendie',
    'RESERVE ARTIFICIELLE': 'Réserve artificielle',
    'RESERVE NATURELLE': 'Réserve naturelle'
  };

  // Un libellé « ressemble » à un type de PEI s'il contient l'un de ces mots
  var TYPE_LOOKS_LIKE = /incendie|r[eé]serve|poteau|bouche|aspiration|citerne|puisard|point d.eau/i;

  // Emprise plausible en Lambert 93 (métropole) : sert à repérer X/Y inversés ou une mauvaise colonne
  var L93_X = [100000, 1300000];
  var L93_Y = [6000000, 7200000];

  // Emprise large du 64 et de ses voisins (en WGS84) : simple avertissement si un point en sort
  var AREA_LON = [-2.2, 0.6];
  var AREA_LAT = [42.6, 43.8];

  // Tolérance pour reconnaître le « même » point entre l'ancien et le nouveau fichier (mètres)
  var SAME_POINT_TOL = 0.05;

  // ---------------------------------------------------------------------------
  // Lecture d'un .xlsx (zip + XML), sans dépendance
  // ---------------------------------------------------------------------------

  function u16(dv, p) { return dv.getUint16(p, true); }
  function u32(dv, p) { return dv.getUint32(p, true); }

  async function readZipEntries(buffer) {
    var u8 = new Uint8Array(buffer);
    var dv = new DataView(buffer);
    var eocd = -1, i;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Ce fichier n\'est pas un classeur Excel .xlsx.');

    var count = u16(dv, eocd + 10);
    var p = u32(dv, eocd + 16);
    var entries = {};
    for (i = 0; i < count; i++) {
      if (u32(dv, p) !== 0x02014b50) throw new Error('Archive .xlsx illisible.');
      var method = u16(dv, p + 10);
      var csize = u32(dv, p + 20);
      var nameLen = u16(dv, p + 28), extraLen = u16(dv, p + 30), commentLen = u16(dv, p + 32);
      var localOffset = u32(dv, p + 42);
      var name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method: method, csize: csize, localOffset: localOffset };
      p += 46 + nameLen + extraLen + commentLen;
    }

    async function extract(name) {
      var e = entries[name];
      if (!e) return null;
      var nLen = u16(dv, e.localOffset + 26), eLen = u16(dv, e.localOffset + 28);
      var start = e.localOffset + 30 + nLen + eLen;
      var data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new Error('Compression .xlsx non prise en charge.');
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Ce navigateur est trop ancien : utilisez une version récente de Chrome, Edge ou Firefox.');
      }
      var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    return { has: function (n) { return !!entries[n]; }, text: async function (n) {
      var d = await extract(n);
      return d ? new TextDecoder('utf-8').decode(d) : null;
    } };
  }

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Contenu .xlsx illisible.');
    return doc;
  }

  function colIndex(ref) {
    var letters = /^[A-Z]+/i.exec(ref);
    if (!letters) return 0;
    var n = 0;
    letters[0].toUpperCase().split('').forEach(function (ch) { n = n * 26 + (ch.charCodeAt(0) - 64); });
    return n - 1;
  }

  /**
   * Lit la première feuille d'un .xlsx.
   * @param {ArrayBuffer} buffer
   * @returns {Promise<Array<{row:number, cells:Array}>>} lignes non vides (row = numéro de ligne Excel)
   */
  async function readXlsxRows(buffer) {
    var zip = await readZipEntries(buffer);
    if (!zip.has('xl/workbook.xml')) throw new Error('Ce fichier n\'est pas un classeur Excel .xlsx.');

    // Chemin de la 1re feuille
    var wb = parseXml(await zip.text('xl/workbook.xml'));
    var sheetEl = wb.getElementsByTagName('sheet')[0];
    if (!sheetEl) throw new Error('Le classeur ne contient aucune feuille.');
    var rid = sheetEl.getAttribute('r:id');
    var sheetPath = 'xl/worksheets/sheet1.xml';
    var relsText = await zip.text('xl/_rels/workbook.xml.rels');
    if (relsText && rid) {
      var rels = parseXml(relsText).getElementsByTagName('Relationship');
      for (var r = 0; r < rels.length; r++) {
        if (rels[r].getAttribute('Id') === rid) {
          var target = rels[r].getAttribute('Target') || '';
          sheetPath = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
        }
      }
    }
    var sheetText = await zip.text(sheetPath);
    if (!sheetText) throw new Error('Feuille de calcul introuvable dans le classeur.');

    // Chaînes partagées
    var shared = [];
    var ssText = await zip.text('xl/sharedStrings.xml');
    if (ssText) {
      var sis = parseXml(ssText).getElementsByTagName('si');
      for (var s = 0; s < sis.length; s++) {
        var ts = sis[s].getElementsByTagName('t'), str = '';
        for (var t = 0; t < ts.length; t++) {
          if (ts[t].parentNode.nodeName !== 'rPh') str += ts[t].textContent;
        }
        shared.push(str);
      }
    }

    // Cellules
    var rowsOut = [];
    var rowEls = parseXml(sheetText).getElementsByTagName('row');
    for (var k = 0; k < rowEls.length; k++) {
      var cells = [];
      var cEls = rowEls[k].getElementsByTagName('c');
      for (var c = 0; c < cEls.length; c++) {
        var cell = cEls[c];
        var type = cell.getAttribute('t');
        var vEl = cell.getElementsByTagName('v')[0];
        var value = null;
        if (type === 'inlineStr') {
          var its = cell.getElementsByTagName('t'), acc = '';
          for (var q = 0; q < its.length; q++) acc += its[q].textContent;
          value = acc;
        } else if (vEl) {
          if (type === 's') value = shared[parseInt(vEl.textContent, 10)];
          else if (type === 'str' || type === 'e') value = vEl.textContent;
          else if (type === 'b') value = vEl.textContent === '1';
          else value = Number(vEl.textContent);
        }
        cells[colIndex(cell.getAttribute('r') || '')] = value;
      }
      if (cells.some(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; })) {
        rowsOut.push({ row: parseInt(rowEls[k].getAttribute('r'), 10) || (k + 1), cells: cells });
      }
    }
    return rowsOut;
  }

  // ---------------------------------------------------------------------------
  // Lambert 93 (EPSG:2154) -> WGS84 (lon/lat en degrés)
  // Ellipsoïde GRS80, parallèles 44° et 49°, origine 46,5° N / 3° E, FE 700 000, FN 6 600 000
  // ---------------------------------------------------------------------------

  var LAMBERT = (function () {
    var a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2);
    var rad = Math.PI / 180;
    var phi0 = 46.5 * rad, phi1 = 44 * rad, phi2 = 49 * rad, lam0 = 3 * rad;
    var X0 = 700000, Y0 = 6600000;
    function m(phi) { var s = Math.sin(phi); return Math.cos(phi) / Math.sqrt(1 - e2 * s * s); }
    function t(phi) {
      var s = Math.sin(phi);
      return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - e * s) / (1 + e * s), e / 2);
    }
    var n = (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
    var F = m(phi1) / (n * Math.pow(t(phi1), n));
    var rho0 = a * F * Math.pow(t(phi0), n);
    return { e: e, n: n, F: F, rho0: rho0, a: a, lam0: lam0, X0: X0, Y0: Y0 };
  }());

  function lambert93ToWgs84(x, y) {
    var L = LAMBERT;
    var dx = x - L.X0, dy = L.rho0 - (y - L.Y0);
    var rho = Math.sqrt(dx * dx + dy * dy);
    var tt = Math.pow(rho / (L.a * L.F), 1 / L.n);
    var theta = Math.atan2(dx, dy);
    var lon = theta / L.n + L.lam0;
    var phi = Math.PI / 2 - 2 * Math.atan(tt);
    for (var i = 0; i < 12; i++) {
      var s = Math.sin(phi);
      var next = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - L.e * s) / (1 + L.e * s), L.e / 2));
      if (Math.abs(next - phi) < 1e-13) { phi = next; break; }
      phi = next;
    }
    return { lon: lon * 180 / Math.PI, lat: phi * 180 / Math.PI };
  }

  // ---------------------------------------------------------------------------
  // Analyse d'UN export (une feuille : colonnes « Valeur » / « Nombre »)
  // ---------------------------------------------------------------------------

  function issue(level, title, detail) { return { level: level, title: title, detail: detail || null }; }
  function norm(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
  function inRange(v, r) { return v >= r[0] && v <= r[1]; }
  function fmtN(n) { return n.toLocaleString('fr-FR'); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function parseCoord(s) {
    s = String(s).replace(/\s/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  function shortLine(s) { s = String(s); return s.length > 70 ? s.slice(0, 67) + '…' : s; }

  /**
   * @param {string} name  nom du fichier (pour les messages)
   * @param {Array} rows   sortie de readXlsxRows
   * @returns {{name, kind, entries, checks, blocking}}
   *   entries : [{row, label, x, y, count}] ; kind : 'communes' | 'types' | null
   */
  function analyseFile(name, rows) {
    var res = { name: name, kind: null, entries: [], checks: [], blocking: false };
    function push(level, title, detail) {
      res.checks.push(issue(level, title, detail));
      if (level === 'error') res.blocking = true;
    }

    if (!rows || !rows.length) { push('error', 'Le fichier est vide.'); return res; }

    var head = rows[0].cells;
    if (norm(head[0]) !== 'valeur' || norm(head[1]) !== 'nombre') {
      push('error', 'Le tableau n\'a pas la forme attendue.',
        'Les colonnes « Valeur » et « Nombre » sont attendues en 1re ligne. Refaites l\'export depuis « Statistiques » (étape 3).');
      return res;
    }

    var data = rows.slice(1);
    if (!data.length) { push('error', 'Aucune ligne de données dans ce fichier.'); return res; }

    var bad = [], swapped = 0, outOfL93 = 0, notOne = 0, codesOnly = 0;
    data.forEach(function (r) {
      var raw = r.cells[0];
      var count = r.cells[1] === null || r.cells[1] === undefined ? 1 : Number(r.cells[1]);
      var parts = String(raw === null || raw === undefined ? '' : raw).split(',');
      if (parts.length < 3) { bad.push({ row: r.row, raw: raw }); return; }
      var y = parseCoord(parts[parts.length - 1]);
      var x = parseCoord(parts[parts.length - 2]);
      var label = parts.slice(0, -2).join(',').trim();
      if (!label || isNaN(x) || isNaN(y)) { bad.push({ row: r.row, raw: raw }); return; }

      if (!(inRange(x, L93_X) && inRange(y, L93_Y))) {
        if (inRange(y, L93_X) && inRange(x, L93_Y)) swapped++; else outOfL93++;
        return;
      }
      if (/^\d+$/.test(label)) codesOnly++;
      if (count !== 1) notOne++;
      res.entries.push({ row: r.row, label: label, x: x, y: y, count: count });
    });

    if (bad.length) {
      push('error', plural(bad.length, 'ligne illisible', 'lignes illisibles') + ' (format attendu : « libellé, X, Y »).',
        bad.slice(0, 5).map(function (b) { return 'ligne ' + b.row + ' : « ' + shortLine(b.raw) + ' »'; }).join('\n') +
        (bad.length > 5 ? '\n… et ' + (bad.length - 5) + ' autres' : '') +
        '\nVérifiez les colonnes sélectionnées à l\'étape 3 : libellé, puis Point SIG X, puis Point SIG Y.');
    }
    if (swapped) {
      push('error', 'Point SIG X et Point SIG Y semblent inversés (' + plural(swapped, 'ligne', 'lignes') + ').',
        'Refaites l\'export en sélectionnant « Point SIG X » avant « Point SIG Y ».');
    }
    if (outOfL93) {
      push('error', plural(outOfL93, 'ligne a', 'lignes ont') + ' des coordonnées qui ne sont pas en Lambert 93.',
        'Vérifiez que ce sont bien « Point SIG X » et « Point SIG Y » qui ont été sélectionnés.');
    }
    if (codesOnly) {
      push('error', 'Le libellé est un code numérique et non un nom (' + plural(codesOnly, 'ligne', 'lignes') + ').',
        'Il faut la « Désignation » (Commune ou type), pas un code.');
    }
    if (res.blocking) return res;

    var typeLike = res.entries.filter(function (e) { return TYPE_LOOKS_LIKE.test(e.label); }).length;
    res.kind = typeLike / res.entries.length >= 0.5 ? 'types' : 'communes';
    push('ok', 'Fichier lisible : ' + plural(res.entries.length, 'ligne', 'lignes') + ', contenu reconnu comme « ' +
      (res.kind === 'types' ? 'type de PEI' : 'commune') + ' ».');
    if (notOne) {
      push('warn', plural(notOne, 'ligne regroupe', 'lignes regroupent') + ' plusieurs éléments (colonne « Nombre » différente de 1).',
        'Un seul point sera créé pour chacune de ces lignes.');
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Analyse des DEUX exports + comparaison avec le geojson actuel
  // ---------------------------------------------------------------------------

  function pairKey(e) { return e.x.toFixed(3) + '|' + e.y.toFixed(3); }
  function titleCase(s) {
    s = String(s).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function isSector(f) { return !!(f && f.properties && f.properties.x !== undefined && f.properties.x !== null); }

  /**
   * @param {Array<{name:string, rows:Array}>} files  exactement 2 fichiers lus
   * @param {Object|null} current  contenu actuel de data/hydrants.geojson (null si indisponible)
   * @returns {{checks:Array, canBuild:boolean, features:Array|null, fileKinds:Object}}
   */
  function analyse(files, current) {
    var out = { checks: [], canBuild: false, features: null, fileKinds: {} };
    function push(level, title, detail) { out.checks.push(issue(level, title, detail)); }

    if (files.length !== 2) {
      push('error', 'Il faut exactement 2 fichiers (un export « communes » et un export « types »).');
      return out;
    }

    // -- 1. chaque fichier
    var an = files.map(function (f) { return analyseFile(f.name, f.rows); });
    an.forEach(function (a) {
      out.fileKinds[a.name] = a.kind;
      a.checks.forEach(function (c) {
        out.checks.push({ level: c.level, title: a.name + ' — ' + c.title, detail: c.detail, file: a.name });
      });
    });
    if (an.some(function (a) { return a.blocking; })) return out;

    // -- 2. un export de chaque nature
    var com = an.filter(function (a) { return a.kind === 'communes'; })[0];
    var typ = an.filter(function (a) { return a.kind === 'types'; })[0];
    if (an[0].kind === an[1].kind || !com || !typ) {
      var dup = an[0].kind === 'types' ? 'deux exports « type de PEI »' : 'deux exports « commune »';
      push('error', 'Les 2 fichiers contiennent la même chose : ' + dup + '.',
        'Il faut un export avec la Commune (étape 3) et un export avec le Type de PEI (étape 4).');
      return out;
    }

    // -- 3. même nombre de lignes
    if (com.entries.length !== typ.entries.length) {
      push('error', 'Les deux exports n\'ont pas le même nombre de lignes (' +
        fmtN(com.entries.length) + ' commune / ' + fmtN(typ.entries.length) + ' type).',
        'Les deux exports doivent porter sur les mêmes PEI, avec les mêmes filtres et au même moment.');
    }

    // -- 4. appariement point par point (mêmes coordonnées X/Y dans les 2 fichiers)
    var pool = {}, sharedCoords = 0;
    typ.entries.forEach(function (e) { (pool[pairKey(e)] = pool[pairKey(e)] || []).push(e); });
    var paired = [], unmatchedCom = [];
    com.entries.forEach(function (c) {
      var list = pool[pairKey(c)];
      if (list && list.length) {
        if (list.length > 1) sharedCoords++;
        paired.push({ c: c, t: list.shift() });
      } else unmatchedCom.push(c);
    });
    var unmatchedTyp = [];
    Object.keys(pool).forEach(function (k) { unmatchedTyp = unmatchedTyp.concat(pool[k]); });

    if (unmatchedCom.length || unmatchedTyp.length) {
      var ex = unmatchedCom.slice(0, 3).map(function (e) { return com.name + ' ligne ' + e.row + ' : ' + e.label + ' (' + e.x + ' ; ' + e.y + ')'; })
        .concat(unmatchedTyp.slice(0, 3).map(function (e) { return typ.name + ' ligne ' + e.row + ' : ' + e.label + ' (' + e.x + ' ; ' + e.y + ')'; }));
      push('error', plural(unmatchedCom.length + unmatchedTyp.length, 'ligne n\'a', 'lignes n\'ont') +
        ' pas de correspondance dans l\'autre fichier (coordonnées X/Y différentes).',
        ex.join('\n') + '\nLes deux exports doivent être faits avec les mêmes filtres, l\'un après l\'autre.');
      return out;
    }
    push('ok', plural(paired.length, 'PEI apparié', 'PEI appariés') + ' entre les deux fichiers (mêmes coordonnées X/Y).');
    if (sharedCoords) {
      push('warn', plural(sharedCoords, 'PEI partage', 'PEI partagent') + ' exactement les mêmes coordonnées qu\'un autre.',
        'L\'appariement commune / type se fait alors dans l\'ordre des fichiers : vérifiez ces points sur la carte.');
    }

    // -- 5. construction des points
    var unknownTypes = {}, outside = 0;
    var features = paired.map(function (p) {
      var raw = p.t.label;
      var mapped = TYPE_MAP[raw.toUpperCase().replace(/\s+/g, ' ')];
      if (!mapped) { mapped = titleCase(raw); unknownTypes[raw] = (unknownTypes[raw] || 0) + 1; }
      var g = lambert93ToWgs84(p.c.x, p.c.y);
      if (!inRange(g.lon, AREA_LON) || !inRange(g.lat, AREA_LAT)) outside++;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Math.round(g.lon * 1e6) / 1e6, Math.round(g.lat * 1e6) / 1e6] },
        properties: { type: mapped, commune: p.c.label, x: p.c.x, y: p.c.y }
      };
    });

    var unknownList = Object.keys(unknownTypes);
    if (unknownList.length) {
      push('warn', plural(unknownList.length, 'type inconnu', 'types inconnus') + ' de l\'appli (affichés en gris) :',
        unknownList.map(function (k) { return '« ' + k + ' » (' + plural(unknownTypes[k], 'point', 'points') + ')'; }).join('\n') +
        '\nIls seront ajoutés tels quels ; pour leur donner une couleur, il faudra les déclarer dans l\'appli.');
    }
    if (outside) {
      push('warn', plural(outside, 'point est', 'points sont') + ' situés hors des Pyrénées-Atlantiques et de leurs environs.',
        'Vérifiez qu\'il ne s\'agit pas d\'une erreur de saisie dans Escort.');
    }

    // -- 6. récapitulatif
    var byType = {}, communes = {};
    features.forEach(function (f) {
      byType[f.properties.type] = (byType[f.properties.type] || 0) + 1;
      communes[f.properties.commune] = true;
    });
    push('ok', plural(features.length, 'PEI', 'PEI') + ' répartis sur ' + plural(Object.keys(communes).length, 'commune', 'communes') + '.',
      Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; })
        .map(function (t) { return fmtN(byType[t]) + ' × ' + t; }).join('\n'));

    // -- 7. comparaison avec les données actuellement publiées
    if (!current || !Array.isArray(current.features)) {
      push('error', 'Impossible de charger le fichier actuel data/hydrants.geojson.',
        'Ouvrez cette page depuis le site publié (GitHub Pages), pas depuis un fichier enregistré sur le PC : ' +
        'il faut le fichier actuel pour conserver les autres points.');
      return out;
    }
    var oldSector = current.features.filter(isSector);
    var used = {}, added = 0, modified = 0, unchanged = 0;
    features.forEach(function (nf) {
      var hit = -1;
      for (var i = 0; i < oldSector.length; i++) {
        if (used[i]) continue;
        var op = oldSector[i].properties;
        if (Math.abs(op.x - nf.properties.x) <= SAME_POINT_TOL && Math.abs(op.y - nf.properties.y) <= SAME_POINT_TOL) { hit = i; break; }
      }
      if (hit < 0) { added++; return; }
      used[hit] = true;
      var o = oldSector[hit].properties;
      if (o.type !== nf.properties.type || o.commune !== nf.properties.commune) modified++; else unchanged++;
    });
    var removed = oldSector.length - Object.keys(used).length;
    var others = current.features.length - oldSector.length;

    if (!oldSector.length) {
      push('ok', 'Le fichier actuel ne contient encore aucun point du secteur : ' + plural(features.length, 'point sera ajouté', 'points seront ajoutés') + '.');
    } else {
      var gap = Math.abs(features.length - oldSector.length);
      var big = gap > Math.max(10, oldSector.length * 0.1);
      push(big ? 'warn' : 'ok',
        'Par rapport au fichier actuel (' + fmtN(oldSector.length) + ' PEI du secteur) : ' +
        added + ' ajouté' + (added > 1 ? 's' : '') + ', ' + removed + ' supprimé' + (removed > 1 ? 's' : '') + ', ' +
        modified + ' modifié' + (modified > 1 ? 's' : '') + ' (commune ou type), ' + unchanged + ' inchangé' + (unchanged > 1 ? 's' : '') + '.',
        big ? 'L\'écart est important : vérifiez que les exports n\'ont pas été filtrés ou tronqués avant de publier.' : null);
    }
    push('ok', 'Les ' + fmtN(others) + ' autres points du fichier actuel (reste du 64) seront conservés tels quels.');

    out.features = features;
    out.canBuild = !out.checks.some(function (c) { return c.level === 'error'; });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Construction du nouveau data/hydrants.geojson
  // ---------------------------------------------------------------------------

  /**
   * Nouveaux points du secteur en tête, puis tous les points non-secteur du fichier actuel, inchangés.
   * @returns {{text:string, total:number, sector:number, others:number}}
   */
  function buildGeojson(current, newFeatures) {
    var others = current.features.filter(function (f) { return !isSector(f); });
    var merged = {};
    Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
    merged.features = newFeatures.concat(others);
    var text = JSON.stringify(merged);

    // Relecture de contrôle
    var back = JSON.parse(text);
    if (back.features.length !== newFeatures.length + others.length) throw new Error('Contrôle du fichier généré : nombre de points incohérent.');
    back.features.forEach(function (f, i) {
      var c = f.geometry && f.geometry.coordinates;
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) throw new Error('Contrôle du fichier généré : coordonnées invalides (point ' + (i + 1) + ').');
    });
    return { text: text, total: merged.features.length, sector: newFeatures.length, others: others.length };
  }

  return {
    readXlsxRows: readXlsxRows,
    analyseFile: analyseFile,
    analyse: analyse,
    buildGeojson: buildGeojson,
    lambert93ToWgs84: lambert93ToWgs84,
    TYPE_MAP: TYPE_MAP
  };
}));
