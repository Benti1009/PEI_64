# PWA — Points d'eau incendie (64)

## Contenu
- `index.html` — la carte (Leaflet, clustering, fonds OSM/IGN, recherche par commune, filtres type/statut)
- `data/hydrants.geojson` — version allégée des 14 059 points (3,4 Mo, contre 8,6 Mo à l'origine)
- `manifest.json` + `icons/` — pour que l'app soit installable sur mobile
- Aucun service worker : pas de mode hors-ligne (comme demandé)

## Mise en ligne sur GitHub Pages
1. Crée un dépôt GitHub (ou utilise un dépôt existant).
2. Place ces fichiers à la racine du dépôt (ou dans un dossier `docs/` si tu préfères cette convention), en conservant l'arborescence :
   ```
   index.html
   manifest.json
   data/hydrants.geojson
   icons/icon-192.svg
   icons/icon-512.svg
   ```
3. Dans les paramètres du dépôt (**Settings → Pages**), choisis la branche et le dossier à publier (`main` / `root`, ou `main` / `docs`).
4. L'app sera accessible à l'URL fournie par GitHub Pages (ex. `https://tonpseudo.github.io/nom-du-repo/`).
5. Sur mobile (Chrome/Safari), ouvrir l'URL puis "Ajouter à l'écran d'accueil" installera la PWA.

## Notes techniques
- Le fond **IGN** utilise les flux Géoplateforme (`data.geopf.fr`), publics et sans clé API.
- La recherche par commune interroge l'**API Géo officielle** (`geo.api.gouv.fr`) au chargement de la page pour récupérer les noms de communes à partir des codes INSEE présents dans le fichier — nécessite donc une connexion internet pour cette fonctionnalité (la carte et les points restent, eux, disponibles dès que le fichier GeoJSON est chargé).
- Champs conservés dans `hydrants.geojson` : `insee`, `id` (réf. SDIS), `gest` (gestionnaire), `type` (type de PEI), `rd` (diamètre/référence), `statut`, `etab` (établissement), `situ` (adresse), `maj` (date de mise à jour).
- Champs retirés pour alléger le fichier : `x`/`y` (Lambert 93, redondants), `lon`/`lat` en double dans `properties` (déjà dans `geometry`), `source_donnee` (valeur constante).

## Pistes d'amélioration (si besoin plus tard)
- Mode hors-ligne (service worker + cache des tuiles et du GeoJSON)
- Export/impression d'une fiche par commune
- Import direct depuis une mise à jour SDIS plus récente
