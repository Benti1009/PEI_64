# PWA — Points d'eau incendie (PEI)

Carte interactive des points d'eau incendie (poteaux, bouches, réserves), avec recherche par
commune et recherche du PEI le plus proche par la route.

## Contenu
- `index.html` — la carte (Leaflet, clustering, fonds OSM/IGN, recherche par commune, filtres par type)
- `data/hydrants.geojson` — les points, avec leur type et leur commune
- `settings.js`, `settings.css`, `pei-update.js` — rubrique **Paramètres > Mise à jour des PEI**
- `manifest.json` + `icons/` — pour que l'app soit installable sur mobile

## Fonctionnalités
- **Carte** avec clustering, fonds OpenStreetMap / IGN Plan / IGN Photo aérienne.
- **Filtres par type** de point d'eau (chips cliquables, bouton tout cocher / tout décocher).
- **Recherche par commune**, entièrement locale.
- **Géolocalisation** (bouton cible).
- **PEI le plus proche par la route** : coller des coordonnées (`latitude, longitude` ou
  `43,11945°N,0,86581°O`) ou cliquer directement sur la carte, pour trouver le PEI le plus
  proche et son itinéraire.
- **Recherche automatique via une autre app** (ex. Raccourci iOS) : ouvrir l'appli avec
  `?q=` suivi d'un point (mêmes formats que ci-dessus) lance directement la recherche.
- **Mise à jour des PEI** : depuis un PC, rubrique ⚙ Paramètres > « Mise à jour des PEI »,
  pour régénérer `hydrants.geojson` à partir de nouveaux exports.
