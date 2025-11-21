# 📄 Documents Générés (PDFs)

Ce dossier contient les documents PDF générés par le code du projet PSE-propales.

## 🎯 Objectif

Ce dossier permet de :
- **Stocker** les documents PDF générés automatiquement
- **Versionner** les différentes itérations des documents
- **Faciliter la révision** en permettant à l'assistant IA d'accéder aux documents
- **Tracer** l'évolution des documents au fil du temps

## 📝 Workflow de révision

1. **Génération** : Générez votre document PDF avec le code du projet
2. **Ajout au repo** : Placez le PDF dans ce dossier
3. **Commit** : Commitez et pushez le fichier sur GitHub
   ```bash
   git add generated_pdfs/votre_document.pdf
   git commit -m "Ajout du document généré pour révision"
   git push
   ```
4. **Révision** : Indiquez à l'assistant IA les modifications souhaitées
5. **Application** : L'assistant applique les changements dans les fichiers sources

## 📋 Convention de nommage

Pour faciliter le suivi, utilisez une convention de nommage claire :
- `DOSSIER_ARCHITECTURE_v1.0.pdf`
- `DOSSIER_ARCHITECTURE_v1.1_revisions.pdf`
- `DOCUMENT_TECHNIQUE_2025-11-21.pdf`

## ⚠️ Note importante

Les PDFs sont des **sorties générées**. Les modifications doivent être appliquées dans les **fichiers sources** (`.md`, `.js`, etc.) pour être pérennes.
