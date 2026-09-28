# API Avatars

Catalogue public d’avatars prédéfinis pour Cannelle, diffusé par les fichiers de `api/` et `images/`. Le catalogue initial est vide.

## Développement

```bash
npm install
cp .env.example .env
npm run dev
```

L’administration est accessible sur `http://127.0.0.1:3005`. Renseigner `REPLICATE_API_TOKEN` dans `.env` pour générer des portraits à partir d’une photo. L’import manuel fonctionne sans jeton. L’administration écoute uniquement sur l’interface locale.

Une fiche requiert un nom, une des 30 voix Gemini 3.1 Flash TTS, une photo de référence, une image de sélection, les trois tons (`neutral`, `success`, `failure`) et une description de chacun. Le sélecteur indique si chaque voix est masculine ou féminine, selon le catalogue vocal de l’éditeur Thaleia. Les images de succès et d’échec doivent être distinctes entre elles et du portrait neutre. Un décor et une `speechPersonality` facultative (300 caractères maximum) peuvent être ajoutés. L’administration accepte PNG, JPEG et WebP. La génération utilise FLUX.2 Pro et, sans décor, le détourage employé par Cannelle. Le portrait de sélection sert de référence au ton neutre, puis aux générations distinctes de succès et d’échec. L’action **Tout générer depuis les références** propose aussi une description courte et une personnalité vocale éditables. Vérifiez les résultats avant d’enregistrer la fiche.

Les descriptions des trois tons sont des prompts détaillés de 170 à 220 mots destinés à la génération text-to-image : traits distinctifs, vêtements, expression, cadrage, fond et lumière. Gemini 2.5 Flash les produit avec une consigne adaptée à la présence d’un décor ou à la transparence. Le bouton **Décrire les portraits** permet de les régénérer à partir des images déjà présentes sans relancer FLUX. Une description trop courte ou indisponible provoque une erreur à corriger avant l’enregistrement ; aucun texte générique n’est inséré automatiquement.

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
