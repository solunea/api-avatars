# API Avatars

Catalogue public d’avatars prédéfinis pour Cannelle, diffusé par les fichiers de `api/` et `images/`.

## Développement

Les fiches détaillées enregistrent des `posePrompts` cachés (`neutral`, `success`, `failure`), au même format que les avatars créés dans Cannelle. Le même appel Gemini que les descriptions propose ces poses selon la personnalité éditoriale, sans générer de nouvelles images. Le bilan iaCreate les exploite ensuite pour ses deux photos de résultat (gestes et expressions). Les anciens fichiers et les imports entièrement décrits sans jeton utilisent des poses de repli. **Décrire les images** permet de générer ou actualiser les poses personnalisées sans régénérer les visuels.

```bash
npm install
cp .env.example .env
npm run dev
```

L’administration est accessible sur `http://127.0.0.1:3005`. Renseigner `REPLICATE_API_TOKEN` dans `.env` pour générer des portraits à partir d’une photo ou d’un prompt. L’import manuel fonctionne sans jeton. L’administration écoute uniquement sur l’interface locale.

`npm run dev` surveille le serveur et ses modules importés, dont les prompts de création : une modification de ces fichiers redémarre le serveur pour que la génération suivante utilise les nouvelles consignes. Une instance lancée auparavant avec `node server.js` doit être redémarrée une première fois.

Le bouton **Régénérer le catalogue** propose **Toutes les planches + prompts plein pied** ou **Tous les neutres + prompts buste**. Il traite tous les avatars enregistrés, indépendamment du filtre de recherche, en réutilisant les sources et l’ADN de chaque fiche. Le portrait et le prompt de l’autre cadrage sont conservés. Chaque résultat terminé est enregistré localement ; les erreurs sont affichées par avatar et **Reprendre** réutilise les images et descriptions déjà obtenues dans cette session. **Arrêter après cet avatar** termine l’avatar courant puis suspend la suite. La publication reste une action séparée.

Après modification d’une image, l’enregistrement conserve les descriptions existantes sans appel IA obligatoire. La fiche est marquée **Descriptions à relire**, y compris après réouverture. **Décrire les images** permet de les actualiser plus tard. Les médias et champs structurels requis restent vérifiés.

Les blocs **Personnage** et **Décor (facultatif)** proposent chacun **Image / Description**. Seul le contenu du mode choisi est affiché. En mode Description, saisir l’apparence du personnage ou le lieu (4000 caractères maximum), puis cliquer sur **Tout générer**. Chaque description produit une image de référence, ensuite le parcours habituel crée le neutre, la planche et leurs descriptions. Les modes et prompts sont conservés dans la fiche détaillée (`sourceMode`, `sourcePrompt`, `decorMode`, `decorPrompt`). Une interruption réutilise les références déjà générées ; modifier une description en crée une nouvelle. Chaque source décrite ajoute un appel de génération d’image (0,008 $ estimés avec Ideogram, hors secours).

Une nouvelle fiche v2 requiert un nom, une voix Gemini, une photo de référence, une image de sélection, un portrait neutre et une planche de personnage. La planche contient uniquement trois vues complètes (face, profil, dos), sans rangée de détails. Deux séparateurs coulissants définissent leurs découpes directement sur l’image. Les zones `sheetRegions` sont des rectangles normalisés `x`, `y`, `width`, `height` entre 0 et 1 pour les trois vues. Après import ou génération, faites glisser les deux séparateurs sur la planche ou déplacez-les avec les flèches du clavier. Les anciennes planches à cinq zones conservent leurs poignées de correction. Un décor et une personnalité vocale facultatifs peuvent être ajoutés. L’administration accepte PNG, JPEG et WebP. Le sélecteur indique le genre de l’échantillon de voix. L’action **Tout générer** produit le neutre, puis génère la planche complète en un seul appel ; la fiche affiche les étapes au fur et à mesure. Vérifiez l’identité, la tenue et le corps entier avant d’enregistrer.

Avec un décor, le portrait neutre recompose le fond autour de la personne. La planche entière est générée sur blanc, puis la planche entière est détourée en un seul appel IA. Une planche importée est également détourée ; si elle est déjà transparente, aucun appel IA n’est effectué. Le bouton **Retirer le fond** permet de traiter une planche existante sans la régénérer. Une photo source qui ne montre pas tout le corps exige une vérification humaine des parties proposées par l’IA.

Un seul appel génère les trois vues en colonnes égales, au ratio 4:3 et en 3 MP. Après détourage, leurs marges transparentes sont retirées et les personnages sont centrés à hauteur égale, jusqu’à 92 % de la hauteur disponible, en conservant une marge latérale. Le bouton **Ajuster le cadrage** applique ce même traitement local aux planches transparentes à trois vues déjà créées, en respectant les séparateurs actuels. Il ne consomme aucun appel IA et prépare une nouvelle image à vérifier avant enregistrement.

Si un neutre est déjà présent sans planche, le bouton **Générer la planche** utilise ce neutre et évite de le recréer. Si Replicate renvoie une erreur temporaire pendant la génération, relancez le même bouton sans changer la photo ni le décor : l’administration reprend les étapes terminées au lieu de recréer leurs images. Une erreur de passerelle est affichée sous forme d’un message court, sans page HTML.

Un appel Gemini analyse le neutre et la planche pour proposer une description courte, une personnalité vocale et des descriptions text-to-image détaillées. L’administration expose seulement Buste et Plein pied ; les descriptions du neutre et de la planche restent dans la fiche API pour compatibilité. Chaque visuel peut être régénéré séparément sans relancer l’autre ni remplacer les descriptions corrigées. Après une régénération isolée, relisez ces textes ou utilisez Décrire les images pour les actualiser. Le bouton **Décrire les images** fonctionne également après un import manuel sans description. Les champs vides sont complétés à l’enregistrement ; les textes déjà saisis sont conservés. Le parcours utilise deux appels Ideogram 4.5 en `very_low` (neutre et planche complète, 0,008 $ par sortie), avec Flux 2 Pro en secours, un détourage pour la planche entière, un détourage pour le neutre sans décor et normalement un appel Gemini. Les anciennes fiches à trois tons restent lisibles. Leur prochaine modification demande de générer ou importer une planche avant de sauvegarder en v2.

```bash
npm run build
npm test
```

Le build valide les fiches et leurs médias, puis produit `api/avatars.json` et `api/avatars/{id}.json`. L’action **Publier** de l’administration valide, crée un commit et pousse `data/`, `api/` et `images/` vers `origin` configuré sur `solunea/api-avatars`.
Tant que Cannelle compatible v2 n’est pas déployé, les fiches v2 peuvent être enregistrées localement mais leur publication est bloquée. Après ce déploiement, définir `ALLOW_V2_PUBLISH=true` dans l’environnement de l’administration et la redémarrer.

Les événements `portrait` incluent les métadonnées `generation` (modèle effectif, coût estimé et tentatives). Le secours conserve les images et paramètres d’origine. Les erreurs avant génération ne supposent aucun coût facturé.

## Contrat de création partagé avec Thaleia

Le champ **ADN du personnage** recueille les consignes de tempérament, émotions, attitudes, gestuelle et manière de parler. Il remplace la saisie de personnalité vocale et de description courte au début de la création. **Tout générer** transmet ce contexte aux générations d’images et à l’analyse groupée qui rédige la personnalité vocale, la description courte, les descriptions buste et plein pied, les poses et les tags. Les références fournies restent prioritaires pour l’identité et la tenue. Les champs produits sont ensuite modifiables. Ces consignes sont conservées dans la fiche et réutilisées lors des régénérations, sans appel IA supplémentaire.

Si l’ADN est vide, le même appel Gemini propose une personnalité de fiction à partir des expressions, de la posture et de la présentation visibles dans les images, puis s’en sert pour rédiger les champs. Cette proposition est affichée dans le champ ADN et reste modifiable ; elle ne prétend pas déduire la personnalité réelle de la personne photographiée. Elle est disponible pour les générations suivantes ; les images de ce premier parcours utilisent les références visuelles fournies.

Les prompts du personnage décrit, du décor décrit, du portrait neutre et de la planche, les modèles, les paramètres de génération et l’analyse Gemini sont communs aux deux outils. La planche est créée avec les références [neutre, photo source], sans contrôle IA supplémentaire du dos. Le recadrage et le nettoyage des halos utilisent aussi les mêmes algorithmes locaux. Un style du thème ne modifie pas le portrait de création ; les variantes stylisées restent disponibles après création.

Le contrat source est dans `editeur/src/assets/js/avatar/shared/`. Ce dépôt embarque une copie autonome dans `lib/`. Depuis le dossier de l’éditeur, synchroniser avec `node tools/sync-avatar-creation-contract.mjs` ; ajouter `--check` pour vérifier sans écrire. Les tests de parité de l’éditeur comparent les deux parcours lorsque les deux dépôts sont présents.

Depuis une photo : **5 appels IA sans décor** (portrait, détourage du portrait, planche, détourage de la planche, descriptions groupées) ou **4 avec décor**. Une source personnage décrite ajoute un appel, un décor décrit en ajoute un autre. L’indexation CLIP à l’enregistrement ajoute normalement un appel, réutilisé si le portrait n’a pas changé. Les erreurs et les descriptions trop courtes peuvent déclencher des reprises.

## Index visuel caché

À chaque enregistrement, le portrait neutre est indexé par `andreasjansson/clip-features` sur Replicate. Le champ interne `clip` contient la version du modèle, l’empreinte SHA-256 de l’image et son vecteur normalisé de 768 valeurs. Il est conservé dans les fiches détaillées et le catalogue pour IA Create, sans champ dans l’administration. Un portrait inchangé réutilise son index ; un nouveau portrait le remplace. Une indisponibilité de CLIP ne bloque pas l’enregistrement : les tags restent utilisables.

Pour indexer les avatars existants avec `REPLICATE_API_TOKEN` configuré :

```bash
npm run index:clip
```

La commande sauvegarde chaque avatar terminé et réutilise les index valides à la reprise. Les fichiers `data/` et `api/` doivent ensuite être publiés pour que Cannelle reçoive les nouveaux index du catalogue distant.

## API publique

| Ressource | URL |
| --- | --- |
| Liste | `https://raw.githubusercontent.com/solunea/api-avatars/main/api/avatars.json` |
| Fiche | `https://raw.githubusercontent.com/solunea/api-avatars/main/api/avatars/{id}.json` |
| Image | `https://raw.githubusercontent.com/solunea/api-avatars/main/images/{fichier}` |

L’éditeur conserve l’identifiant `preset-{slug}` dans le design et charge la fiche et les médias depuis ce dépôt au moment de l’utilisation. Renommer un avatar garde son identifiant ; supprimer l’avatar rend sa référence indisponible dans les designs existants.
