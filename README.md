# MSI Propales · Assistant de génération de propositions

MSI Propales est une application Google Apps Script qui automatise la création de documents Google Docs à partir d'un modèle colorisé et de contenus générés avec les API DeepSeek. Le dépôt rassemble à la fois le back-end Apps Script (`Code.js`) et l'interface utilisateur web (`Index.html`) déployés sous forme de Web App.

L'objectif de ce document est d'offrir plusieurs niveaux de lecture pour que chacun puisse prendre la main sur l'outil, le maintenir et le faire évoluer sereinement.

- [Niveau 1 : prise en main immédiate](#niveau-1--prise-en-main-immédiate)
- [Niveau 2 : comprendre le code](#niveau-2--comprendre-le-code)
- [Niveau 3 : vision d'ensemble du projet](#niveau-3--vision-densemble-du-projet)
- [Références rapides](#références-rapides)

---

## Niveau 1 : prise en main immédiate
Ce chapitre est destiné aux personnes qui veulent utiliser l'outil au quotidien sans plonger dans le code.

### Pré-requis
1. Un compte Google avec accès Google Drive, Google Docs et Google Apps Script.
2. Un modèle Google Docs prêt à l'emploi, avec des zones surlignées correspondant aux champs de la proposition.
3. Une clé API DeepSeek valide et des droits pour créer un fichier Google Sheet (journal des coûts).

### Étapes d'installation
1. **Importer le projet** :
   - Dans Google Drive, créez un nouveau projet Apps Script et importez les fichiers `Code.js`, `Index.html` et `appsscript.json` depuis ce dépôt.
2. **Configurer les identifiants** :
   - Dans `Code.js`, renseignez `TEMPLATE_DOC_ID` (ID du Google Doc modèle) et `DESTINATION_FOLDER_ID` (dossier Drive où seront copiées les propositions).
   - Ouvrez *Project Settings → Script properties* et ajoutez `DEEPSEEK_API_KEY` avec votre clé.
   - Facultatif : ajoutez `COST_SHEET_ID` si vous avez déjà un Google Sheet de suivi des coûts. Sinon, l'application en créera un automatiquement.
3. **Déployer la Web App** :
   - Dans Apps Script, cliquez sur *Deploy → New deployment*.
   - Type : *Web app*, exécution *as Me*, accès *Only myself* (modifiable selon vos besoins).
   - Copiez l'URL générée et partagez-la avec les personnes habilitées.

### Utilisation quotidienne
1. Ouvrez la Web App et remplissez le formulaire (infos client, contact, thématique…).
2. Cliquez sur **Générer la propale**.
3. Patientez pendant que l'IA génère les sections `contexte`, `démarche`, `phases` et `phrase d'accroche`.
4. Un lien vers le Google Doc final apparaît une fois le traitement terminé.
5. Le journal des coûts est alimenté automatiquement dans un Google Sheet (lien disponible dans le modal de confirmation si la propriété `COST_SHEET_ID` est configurée).

### Bonnes pratiques
- Vérifiez que le modèle Google Docs contient bien tous les placeholders `[[champ]]` listés dans le formulaire.
- Mettez à jour la clé DeepSeek avant qu'elle n'expire pour éviter les échecs d'appel API.
- En cas d'erreur « DeepSeek HTTP », revérifiez votre clé API et les quotas.

---

## Niveau 2 : comprendre le code
Cette section s'adresse aux personnes qui doivent lire et ajuster le code Apps Script ou l'interface HTML.

### Structure des fichiers
```
.
├── Code.js             # Back-end Apps Script (LLM, Google Docs, logs)
├── Index.html          # Interface web (UI/UX futuriste + scripts front)
├── appsscript.json     # Configuration du projet Apps Script
├── new-mcp-server.yaml # Exemple de configuration MCP (optionnel)
└── settings.json       # Paramètres d'éditeur (confort VS Code)
```

### Flux principal
1. **Formulaire HTML (`Index.html`)** : collecte les données, ouvre un modal de suivi de progression et appelle `google.script.run.generateFullProposal(fd)` côté serveur (un alias `generateFromForm` reste disponible pour les anciennes versions de l'interface).
2. **Back-end (`Code.js`)** :
   - `generateFullProposal(formData)` valide les champs obligatoires, construit un *prompt* (`brief`) et appelle `callLLM_`.
   - `callLLM_` envoie la requête à DeepSeek (modèle, température, `max_tokens`) et calcule le coût via `calculateUsageCost_`.
   - `createTemplateCopy` duplique le modèle dans le dossier cible.
   - `applyUpdatesToDoc_` remplace les placeholders `[[champ]]`, supprime le surlignage et gère les cas UX particuliers (ex : éviter la répétition client/entreprise).
   - `logApiUsage_` et `logCostEstimation_` alimentent un Google Sheet de suivi (`getOrCreateCostSheet_`).
3. **Réponse au front** : URL du document, sections IA, latence et lien vers le journal de coûts (si disponible).

### Points d'attention dans le code
- **Configuration** : les constantes `TEMPLATE_DOC_ID`, `DESTINATION_FOLDER_ID` et `COLOR_MAPPING` sont centralisées en tête de fichier.
- **Couleurs ↔ champs** : `COLOR_MAPPING` et `buildMaps_` permettent de convertir le surlignage du modèle en champ logique (utile pour le nettoyage final).
- **Gestion des erreurs** : la majorité des appels (`UrlFetchApp`, `DriveApp`, `DocumentApp`) sont encapsulés dans des `try/catch` pour renvoyer des erreurs explicites au front.
- **Logo ICAM** : `getIcamLogoDataUrl` tente de récupérer le logo officiel et le met en cache (`PropertiesService`). Un *fallback* base64 est fourni.
- **Fonctions publiques** :
  - `doGet` → point d'entrée Web App.
  - `getSettings` → exposer les modèles et tarifs DeepSeek au front (si besoin).
  - `generateFullProposal`, `estimateAndLogCost_public`, `getCostLogUrl_public` → actions principales appelables par `google.script.run`.

> ℹ️ Si vous exposez une nouvelle fonction à l'interface, pensez à l'ajouter explicitement dans `Index.html` (ex : `google.script.run.maNouvelleFonction`).

### Adapter l'interface
- Le CSS/JS inline est contenu en bas de `Index.html`. Les fonctions utilitaires (`showModal`, `collectForm`, etc.) peuvent être modifiées directement.
- Pour l'auto-complétion ou la validation front, ajoutez vos scripts avant la balise de fermeture `</script>`.
- L'interface détecte si `google.script.run` est absent (tests hors Apps Script) et affiche un message de prévisualisation.

---

## Niveau 3 : vision d'ensemble du projet
Cette dernière partie fournit une vue globale pour les responsables techniques ou les futurs mainteneurs.

### Architecture fonctionnelle
1. **Entrée utilisateur** : interface Web moderne (JS + CSS) intégrée dans Apps Script.
2. **Moteur IA** : DeepSeek (`deepseek-reasoner` par défaut, `deepseek-chat` possible) via API REST sécurisée par clé stockée côté serveur (`ScriptProperties`).
3. **Génération documentaire** : duplication d'un Google Doc modèle, remplacement des placeholders colorisés, suppression des surlignages.
4. **Stockage** : documents générés dans un dossier Drive dédié, journal de coûts dans un Google Sheet.
5. **Observabilité** : temps de réponse, coûts, informations client, thématique et durée sont tracés à chaque appel.

### Diagramme de séquence (textuel)
1. Utilisateur ↦ Web App : soumission du formulaire.
2. Web App ↦ Apps Script : `generateFullProposal(formData)`.
3. Apps Script ↦ DeepSeek API : requête JSON (prompt système + utilisateur).
4. DeepSeek ↦ Apps Script : réponse JSON (sections IA + usage tokens).
5. Apps Script : duplication du modèle, injection des contenus, nettoyage des surlignages.
6. Apps Script ↦ Google Drive : enregistrement du document.
7. Apps Script ↦ Google Sheets : journalisation du coût.
8. Apps Script ↦ Web App : réponse finale (URL document + métadonnées).

### Maintenance & évolutions possibles
- **Changer de modèle IA** : mettre à jour `DEEPSEEK_MODELS`, `DEFAULT_DEEPSEEK_MODEL` et la grille tarifaire `DEEPSEEK_PRICING`.
- **Ajouter des champs** :
  1. Ajouter le champ dans le formulaire HTML (`Index.html`).
  2. Mettre à jour `COLOR_MAPPING` et le modèle Google Docs.
  3. Gérer les nouvelles valeurs dans `formData` (ex : traitement spécifique dans `generateFullProposal`).
- **Audit sécurité** : vérifier régulièrement les droits du déploiement Web App (qui peut exécuter, qui peut accéder au dossier Drive).
- **Gestion des quotas** : surveiller le Google Sheet de coûts pour anticiper les dépassements.

### Checklist avant passation
- [ ] Les IDs `TEMPLATE_DOC_ID` et `DESTINATION_FOLDER_ID` pointent vers des ressources accessibles.
- [ ] La clé `DEEPSEEK_API_KEY` est valide et documentée.
- [ ] Le Google Sheet de coûts existe et est partagé avec les personnes concernées.
- [ ] Un guide interne décrit le processus de déploiement (ou ce README est partagé).
- [ ] Les tests manuels de génération sont passés avec succès après chaque modification majeure.

---

## Références rapides
- **Script Properties** : *Project Settings → Script properties* (Apps Script).
- **Documentation DeepSeek** : <https://api.deepseek.com/>
- **API Google Apps Script** :
  - [`DocumentApp`](https://developers.google.com/apps-script/reference/document)
  - [`DriveApp`](https://developers.google.com/apps-script/reference/drive)
  - [`UrlFetchApp`](https://developers.google.com/apps-script/reference/url-fetch)
  - [`PropertiesService`](https://developers.google.com/apps-script/reference/properties/properties-service)

Bon usage et bonne continuation sur le projet ! 😊
