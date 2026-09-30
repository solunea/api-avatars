# API Avatars

Catalogue public d’avatars prédéfinis pour Cannelle, diffusé par les fichiers de `api/` et `images/`.

## Développement

Les fiches détaillées enregistrent des `posePrompts` cachés (`neutral`, `success`, `failure`), au même format que les avatars créés dans Cannelle. Le même appel Gemini que les descriptions propose ces poses selon la personnalité éditoriale, sans générer de nouvelles images. Le bilan iaCreate les exploite ensuite pour ses deux photos de résultat (gestes et expressions). Les anciens fichiers et les imports entièrement décrits sans jeton utilisent des poses de repli. **Décrire les images** permet de générer ou actualiser les poses personnalisées sans régénérer les visuels.

```bash
npm install
cp .env.example .env
npm run dev
```

L’administration est accessible sur `http://127.0.0.1:3005`. Renseigner `REPLICATE_API_TOKEN` dans `.env` pour générer des portraits à partir d’une photo. L’import manuel fonctionne sans jeton. L’administration écoute uniquement sur l’interface locale.

Une nouvelle fiche v2 requiert un nom, une voix Gemini, une photo de référence, une image de sélection, un portrait neutre et une planche de personnage. La planche contient uniquement trois vues complètes (face, profil, dos), sans rangée de détails. Deux séparateurs coulissants définissent leurs découpes directement sur l’image. Les zones `sheetRegions` sont des rectangles normalisés `x`, `y`, `width`, `height` entre 0 et 1 pour les trois vues. Après import ou génération, faites glisser les deux séparateurs sur la planche ou déplacez-les avec les flèches du clavier. Les anciennes planches à cinq zones conservent leurs poignées de correction. Un décor et une personnalité vocale facultatifs peuvent être ajoutés. L’administration accepte PNG, JPEG et WebP. Le sélecteur indique le genre de l’échantillon de voix. L’action **Tout générer depuis les références** produit le neutre, puis génère les vues séparément avant de les assembler ; la fiche affiche les étapes au fur et à mesure. Vérifiez l’identité, la tenue et le corps entier avant d’enregistrer.

Avec un décor, le portrait neutre recompose le fond autour de la personne. Les vues de la planche sont générées sur blanc, puis la planche entière est détourée en un seul appel IA. Une planche importée est également détourée ; si elle est déjà transparente, aucun appel IA n’est effectué. Le bouton **Retirer le fond** permet de traiter une planche existante sans la régénérer. Une photo source qui ne montre pas tout le corps exige une vérification humaine des parties proposées par l’IA.

Si un neutre est déjà présent sans planche, le bouton **Générer la planche** utilise ce neutre et évite de le recréer. Si Replicate renvoie une erreur temporaire pendant la génération, relancez le même bouton sans changer la photo ni le décor : l’administration reprend les étapes terminées au lieu de recréer leurs images. Les vues partielles sont conservées temporairement dans `uploads/` et retirées après une génération complète. Une erreur de passerelle est affichée sous forme d’un message court, sans page HTML.

Un appel Gemini analyse le neutre et la planche pour proposer une description courte, une personnalité vocale et des descriptions text-to-image détaillées. L’administration expose seulement Buste et Plein pied ; les descriptions du neutre et de la planche restent dans la fiche API pour compatibilité. Chaque visuel peut être régénéré séparément sans relancer l’autre ni remplacer les descriptions corrigées. Après une régénération isolée, relisez ces textes ou utilisez Décrire les images pour les actualiser. Le bouton **Décrire les images** fonctionne également après un import manuel sans description. Les champs vides sont complétés à l’enregistrement ; les textes déjà saisis sont conservés. Le parcours utilise quatre appels FLUX (neutre et trois vues), un détourage pour la planche entière, un détourage pour le neutre sans décor et normalement un appel Gemini. Les anciennes fiches à trois tons restent lisibles. Leur prochaine modification demande de générer ou importer une planche avant de sauvegarder en v2.

```bash
npm run build
npm test
```

Le build valide les fiches et leurs médias, puis produit `api/avatars.json` et `api/avatars/{id}.json`. L’action **Publier** de l’administration valide, crée un commit et pousse `data/`, `api/` et `images/` vers `origin` configuré sur `solunea/api-avatars`.
Tant que Cannelle compatible v2 n’est pas déployé, les fiches v2 peuvent être enregistrées localement mais leur publication est bloquée. Après ce déploiement, définir `ALLOW_V2_PUBLISH=true` dans l’environnement de l’administration et la redémarrer.

## API publique

| Ressource | URL |
| --- | --- |
| Liste | `https://raw.githubusercontent.com/solunea/api-avatars/main/api/avatars.json` |
| Fiche | `https://raw.githubusercontent.com/solunea/api-avatars/main/api/avatars/{id}.json` |
| Image | `https://raw.githubusercontent.com/solunea/api-avatars/main/images/{fichier}` |

L’éditeur conserve l’identifiant `preset-{slug}` dans le design et charge la fiche et les médias depuis ce dépôt au moment de l’utilisation. Renommer un avatar garde son identifiant ; supprimer l’avatar rend sa référence indisponible dans les designs existants.
