# PWA — Points d'eau incendie (secteur Soumoulou / Pontacq)

## Contenu
- `index.html` — la carte (Leaflet, clustering, fonds OSM/IGN, recherche par commune, filtres par type)
- `data/hydrants.geojson` — les 270 PEI du secteur (22 communes, avec leurs coordonnées Lambert 93 `x`/`y`)
  + ~14 000 autres points du 64 (type « Autre », commune = code INSEE), désactivés par défaut sur la carte
- `settings.js`, `settings.css`, `pei-update.js` — rubrique **Paramètres > Mise à jour des PEI** (voir plus bas)
- `manifest.json` + `icons/` — pour que l'app soit installable sur mobile
- Aucun service worker : pas de mode hors-ligne (comme demandé)

## Jeu de données
Les 270 points du secteur proviennent de deux exports Excel du site Escort (un avec le type de PEI,
un avec la commune), appariés par leurs coordonnées X/Y puis reprojetés de
**Lambert 93 (EPSG:2154) vers WGS84** pour être exploitables en GeoJSON. La conversion se fait à la
génération du fichier (voir « Mise à jour des PEI ») : la carte n'a aucun calcul de projection à faire.

**Repère important :** dans `hydrants.geojson`, un point du secteur est un point qui porte les
propriétés `x` et `y`. C'est ce qui permet à l'outil de mise à jour de remplacer uniquement ces
270 points et de laisser tous les autres intacts.

Champs de chaque point :

| Champ     | Contenu |
|-----------|---------|
| `type`    | Poteau incendie 60 m³/h, Poteau incendie 30 m³/h, Bouche incendie, Réserve artificielle, Réserve naturelle |
| `commune` | Nom de la commune |
| `x`, `y`  | Coordonnées Lambert 93 d'origine (affichées dans la popup, utiles pour recoupement SDIS) |

Répartition : 240 poteaux 60 m³/h, 25 réserves artificielles, 3 poteaux 30 m³/h,
1 bouche incendie, 1 réserve naturelle.

Communes couvertes : Andoins, Arrien, Artigueloutan, Bédeille, Eslourenties-Daban, Espoey,
Espéchède, Gardères, Gomer, Lespourcy, Limendous, Lombia, Lourenties, Lucgarier, Luquet,
Nousty, Ouillon, Saubole, Sedze-Maubecq, Sedzère, Soumoulou, Urost.

## Fonctionnalités
- **Carte** avec clustering, fonds OpenStreetMap / IGN Plan / IGN Photo aérienne. Le cadrage
  initial s'ajuste automatiquement sur l'emprise des données.
- **Filtres par type** de point d'eau (chips cliquables, bouton tout cocher / tout décocher).
- **Recherche par commune** : entièrement locale, construite à partir du champ `commune` du
  GeoJSON. Aucun appel réseau, aucun code INSEE — la recherche fonctionne donc même si les
  services externes sont indisponibles.
- **Géolocalisation** (bouton cible).
- **PEI le plus proche par la route** (voir ci-dessous).

## PEI le plus proche par la route
Dans la barre latérale, le bloc « PEI le plus proche » permet :
- de **coller des coordonnées** au format `latitude, longitude` (ex. `43.2719, -0.2613`) puis
  cliquer « Chercher ce point » ;
- ou de cliquer sur **« 📍 Cliquer sur la carte »** puis de cliquer directement sur la carte.

L'app calcule alors le PEI le plus proche **par la route (mode voiture)**, pas à vol d'oiseau :
1. présélection des ~25 PEI les plus proches à vol d'oiseau, parmi ceux qui passent les filtres
   de type actifs (calcul local, instantané) ;
2. appel à l'API publique **OSRM** (`router.project-osrm.org`, gratuite, sans clé) pour obtenir
   la distance et le temps de trajet réels jusqu'à chacun de ces candidats ;
3. le plus proche par la route est mis en évidence, avec l'itinéraire tracé, la distance, la
   durée, le type et la commune.

⚠️ Cette fonctionnalité nécessite une connexion internet et dépend du serveur de démonstration
public d'OSRM, qui n'offre pas de garantie de disponibilité en production. Pour fiabiliser :
héberger sa propre instance OSRM, ou passer par un service payant (OpenRouteService, Mapbox).

## Mise à jour des PEI du secteur
Depuis un **PC uniquement** : lien **⚙ Paramètres** en bas de la barre latérale > rubrique
« Mise à jour des PEI ». La rubrique décrit pas à pas les deux exports à faire sur
dei64.escort.fr (Pavé « PEI » > « Statistiques » : Désignation / Commune + Point SIG X + Point SIG Y,
puis Désignation / type + Point SIG X + Point SIG Y), puis :

1. les 2 fichiers Excel sont déposés dans la fenêtre (glisser-déposer, bouton, ou Ctrl+V) ;
2. ils sont **vérifiés avant toute génération** : format des colonnes, X/Y inversés, coordonnées
   hors Lambert 93, deux exports de même nature, lignes sans correspondance entre les deux fichiers,
   types inconnus, écart important avec le fichier actuel ;
3. si tout est bon, le bouton « Générer hydrants.geojson » télécharge le nouveau fichier (points du
   secteur remplacés, tous les autres points conservés tels quels) ;
4. ce fichier est déposé à la main dans le dossier `data` du dépôt GitHub (« Add file » > « Upload files »
   > « Commit changes »).

Tout se fait dans le navigateur : aucun identifiant n'est stocké ni envoyé, aucun jeton GitHub n'est
nécessaire, les fichiers Excel ne quittent pas le PC. L'outil a besoin de charger le
`data/hydrants.geojson` actuel : il doit donc être utilisé depuis le site publié (GitHub Pages).

## Mise en ligne sur GitHub Pages
1. Crée un dépôt GitHub (ou utilise un dépôt existant).
2. Place ces fichiers à la racine du dépôt (ou dans un dossier `docs/`), en conservant
   l'arborescence :
   ```
   index.html
   manifest.json
   data/hydrants.geojson
   icons/icon-192.svg
   icons/icon-512.svg
   ```
3. Dans **Settings → Pages**, choisis la branche et le dossier à publier
   (`main` / `root`, ou `main` / `docs`).
4. L'app sera accessible à l'URL fournie par GitHub Pages
   (ex. `https://tonpseudo.github.io/nom-du-repo/`).
5. Sur mobile (Chrome/Safari), ouvrir l'URL puis « Ajouter à l'écran d'accueil » installera la PWA.

## Notes techniques
- Les fonds **IGN** utilisent les flux Géoplateforme (`data.geopf.fr`), publics et sans clé API.
- Connexion internet requise uniquement pour : les tuiles de fond de carte et le calcul
  d'itinéraire OSRM. Les points et la recherche par commune sont chargés depuis le GeoJSON local.
- Reprojection Lambert 93 → WGS84 : projection conique conforme de Lambert (2 parallèles),
  ellipsoïde GRS80, parallèles standards 44° et 49°, origine 46,5° N / 3° E,
  faux est 700 000 m, faux nord 6 600 000 m.

## Pistes d'amélioration (si besoin plus tard)
- Mode hors-ligne (service worker + cache des tuiles et du GeoJSON)
- Export/impression d'une fiche par commune
- Réintégration d'infos SDIS si disponibles (référence, gestionnaire, adresse, date de MAJ)
