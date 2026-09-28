# API Avatars

Catalogue public d’avatars prédéfinis pour Cannelle, diffusé par les fichiers de `api/` et `images/`. Le catalogue initial est vide.

## Développement

```bash
npm install
cp .env.example .env
npm run dev
```

L’administration est accessible sur `http://127.0.0.1:3005`. Renseigner `REPLICATE_API_TOKEN` dans `.env` pour générer des portraits à partir d’une photo. L’import manuel fonctionne sans jeton. L’administration écoute uniquement sur l’interface locale.

Une fiche requiert un nom, une voix Gemini intégrée à Cannelle, une photo de référence, une image de sélection, les trois tons (`neutral`, `success`, `failure`) et une description de chacun. Un décor et une `speechPersonality` facultative (300 caractères maximum) peuvent être ajoutés. L’administration accepte PNG, JPEG et WebP. La génération utilise FLUX.2 Pro et, sans décor, le détourage employé par Cannelle.

```bash
npm run build
npm test
```

Le build valide les fiches et leurs médias, puis produit `api/avatars.json` et `api/avatars/{id}.json`. L’action **Publier** de l’administration valide, crée un commit et pousse `data/`, `api/` et `images/` vers `origin` configuré sur `solunea/api-avatars`.

## API publique

| Ressource | URL |
| --- | --- |
| Liste | `https://raw.githubusercontent.com/solunea/api-avatars/main/api/avatars.json` |
| Fiche | `https://raw.githubusercontent.com/solunea/api-avatars/main/api/avatars/{id}.json` |
| Image | `https://raw.githubusercontent.com/solunea/api-avatars/main/images/{fichier}` |

L’éditeur conserve l’identifiant `preset-{slug}` dans le design et charge la fiche et les médias depuis ce dépôt au moment de l’utilisation. Renommer un avatar garde son identifiant ; supprimer l’avatar rend sa référence indisponible dans les designs existants.
