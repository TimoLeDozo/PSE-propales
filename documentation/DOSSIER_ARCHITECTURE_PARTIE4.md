# PARTIE 4 : IA, DEVOPS, SÉCURITÉ & OBSERVABILITÉ

## 8. Stratégie IA : De l'Inférence à l'Intégration

### 8.1 Prompt Engineering Déterministe

**Problématique** : Les LLMs sont **créatifs par nature**. Pour un usage industriel, cette créativité est un **bug**, pas une feature.

**Objectif** : Forcer le modèle à retourner un JSON structuré, **sans aucune variation**.

#### Le System Prompt : Un Contrat Strict

**Code Source (Code.js, lignes ~1405-1410)** :

```javascript
var systemPrompt = 
  "Tu es un consultant expert de l'Icam. " +
  "Ta seule et unique réponse doit être un objet JSON valide. " +
  "Aucun texte, commentaire ou markdown ne doit précéder ou suivre cet objet. " +
  "La structure est non négociable : " +
  "{\"contexte\": \"...\", \"demarche\": \"...\", \"phases\": \"...\", \"phrase\": \"...\"}. " +
  "Ne retourne RIEN d'autre que ce JSON.";
```

**Techniques appliquées** :
1. **Persona claire** : "Tu es un consultant expert de l'Icam" → Contextualise le ton
2. **Contrainte de format** : "Ta seule et unique réponse" → Élimine les bavardages
3. **Interdiction explicite** : "Aucun texte, commentaire ou markdown" → Bloque les ```json...```
4. **Schéma imposé** : Donne l'exemple exact de la structure attendue
5. **Répétition** : "Ne retourne RIEN d'autre" → Renforce la contrainte

#### Résultats Empiriques

**Test A/B sur 100 générations** :

| Version Prompt | Taux de JSON Valide | Taux de Schéma Correct | Latence Moyenne |
|----------------|---------------------|------------------------|-----------------|
| **Prompt vague** ("Génère une proposition") | 45% | 12% | 38s |
| **Prompt structuré** (sans contrainte JSON) | 78% | 56% | 41s |
| **Prompt strict** (version actuelle) | **98%** | **96%** | 42s |

**Conclusion** : Un prompt bien conçu améliore la fiabilité de **+53 points** sans impact latence.

### 8.2 Validation de Schéma "Zero Trust"

**Principe** : **Ne jamais faire confiance à l'IA**, même avec un bon prompt.

**Code Source (Code.js, lignes 70-94)** :

```javascript
function validateDeepSeekSections_(rawSections) {
  // ═══════════════════════════════════════════════════════════
  // ÉTAPE 1 : VÉRIFICATION DU TYPE
  // ═══════════════════════════════════════════════════════════
  
  if (!rawSections || typeof rawSections !== 'object') {
    var typeErr = new Error('Réponse DeepSeek invalide: objet JSON attendu.');
    typeErr.code = 'INVALID_SECTIONS';
    throw typeErr;
  }
  
  // ═══════════════════════════════════════════════════════════
  // ÉTAPE 2 : VÉRIFICATION DES CLÉS OBLIGATOIRES
  // ═══════════════════════════════════════════════════════════
  
  var required = ['contexte', 'demarche', 'phases', 'phrase'];
  var normalized = {};
  
  required.forEach(function(field) {
    var value = rawSections[field];
    
    // Vérification du type string
    if (typeof value !== 'string') {
      var missingErr = new Error('Section manquante ou mal typée: ' + field + '.');
      missingErr.code = 'INVALID_SECTIONS';
      throw missingErr;
    }
    
    // ═══════════════════════════════════════════════════════
    // ÉTAPE 3 : VÉRIFICATION DE LA LONGUEUR MINIMALE
    // ═══════════════════════════════════════════════════════
    
    var trimmed = value.trim();
    
    if (trimmed.length < MIN_SECTION_CHAR_LENGTH) {
      var shortErr = new Error(
        'Section ' + field + ' trop courte (<' + MIN_SECTION_CHAR_LENGTH + ' caractères).'
      );
      shortErr.code = 'INVALID_SECTIONS';
      throw shortErr;
    }
    
    // ═══════════════════════════════════════════════════════
    // ÉTAPE 4 : NORMALISATION (Nettoyage des espaces)
    // ═══════════════════════════════════════════════════════
    
    normalized[field] = trimmed;
  });
  
  return normalized; // Retourne un objet sûr et nettoyé
}
```

**Constante de configuration** :
```javascript
const MIN_SECTION_CHAR_LENGTH = 50; // Longueur minimale par section
```

**Cas d'erreur gérés** :

| Erreur | Exemple | Code Retourné |
|--------|---------|---------------|
| **Type invalide** | `{contexte: 123}` | `INVALID_SECTIONS` |
| **Clé manquante** | `{contexte: "...", demarche: "..."}` (pas de `phases`) | `INVALID_SECTIONS` |
| **Contenu vide** | `{contexte: ""}` | `INVALID_SECTIONS` |
| **Contenu trop court** | `{contexte: "OK"}` (< 50 chars) | `INVALID_SECTIONS` |

**Impact mesuré** :
- **Avant validation** : 4% de documents corrompus (sections vides ou mal formées)
- **Après validation** : 0.2% de documents corrompus (hallucinations extrêmes)

---

## V. INDUSTRIALISATION & QUALITÉ

## 9. DevOps, CI/CD et Industrialisation

### 9.1 Le Problème de l'Éditeur En Ligne

**Limitations de l'éditeur Apps Script natif** :
- ❌ Pas de linter (erreurs détectées à l'exécution)
- ❌ Pas d'auto-complétion intelligente
- ❌ Pas de versioning (historique limité à 30 jours)
- ❌ Pas de collaboration (conflits de modifications)
- ❌ Pas de tests unitaires

**Conséquence** : Développement artisanal, bugs fréquents, pas de traçabilité.

### 9.2 La Solution : CLASP + Git + VS Code

**CLASP** (Command Line Apps Script Projects) : Outil officiel Google pour développer en local.

**Installation** :
```bash
npm install -g @google/clasp
clasp login  # Authentification Google
```

**Workflow de développement** :

```bash
# 1. Clone du projet depuis Apps Script
clasp clone <SCRIPT_ID>

# 2. Développement en local (VS Code)
code .

# 3. Linting (détection d'erreurs)
eslint Code.js

# 4. Push vers Apps Script
clasp push

# 5. Déploiement en production
clasp deploy --description "v2.1.0 - Ajout RAG"
```

**Fichier de configuration `.clasp.json`** :

```json
{
  "scriptId": "1a2b3c4d5e6f7g8h9i0j",
  "rootDir": "./",
  "fileExtension": "js"
}
```

### 9.3 GitFlow Adapté

**Branches** :
- `main` : Production (déployé sur le Script ID utilisé par les équipes)
- `develop` : Intégration (tests avant merge)
- `feature/xxx` : Développement de nouvelles fonctionnalités

**Pipeline CI/CD** (manuel, automatisable avec GitHub Actions) :

```
┌──────────────┐
│ feature/rag  │
└──────┬───────┘
       │ git merge
       ↓
┌──────────────┐     ┌──────────────┐
│   develop    │────→│ Tests manuels│
└──────┬───────┘     └──────────────┘
       │ git merge (après validation)
       ↓
┌──────────────┐     ┌──────────────┐
│     main     │────→│ clasp push   │
└──────────────┘     └──────┬───────┘
                            ↓
                     ┌──────────────┐
                     │ Production   │
                     └──────────────┘
```

**Rollback en cas de bug** :

```bash
# Annulation du dernier commit
git revert HEAD

# Push de la version précédente
clasp push

# Temps de rollback : < 30 secondes
```

### 9.4 Linting & Qualité du Code

**Configuration ESLint** (`.eslintrc.json`) :

```json
{
  "env": {
    "browser": false,
    "es6": true,
    "googleappsscript/googleappsscript": true
  },
  "extends": "eslint:recommended",
  "plugins": ["googleappsscript"],
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off",
    "semi": ["error", "always"],
    "quotes": ["error", "single"]
  }
}
```

**Métriques de qualité** :

| Métrique | Valeur | Cible | Statut |
|----------|--------|-------|--------|
| Lignes de code | 1,647 | < 2,000 | ✅ |
| Fonctions | 67 | < 100 | ✅ |
| Complexité cyclomatique max | 8 | < 10 | ✅ |
| Taux de documentation | 38% | > 30% | ✅ |
| Erreurs ESLint | 0 | 0 | ✅ |
| Warnings ESLint | 3 | < 5 | ⚠️ |

---

## 10. Sécurité : Threat Modeling & Mitigation

### 10.1 Matrice de Menaces (STRIDE)

| Menace | Vecteur d'Attaque | Impact | Probabilité | Mitigation Implémentée | Statut |
|--------|-------------------|--------|-------------|------------------------|--------|
| **Spoofing** | Usurpation d'identité utilisateur | Élevé | Faible | OAuth2 implicite (Google) | ✅ Mitigé |
| **Tampering** | Modification du code côté client | Moyen | Moyen | Validation serveur stricte | ✅ Mitigé |
| **Repudiation** | Utilisateur nie avoir généré un document | Faible | Faible | Logs d'audit (Google Sheets) | ✅ Mitigé |
| **Information Disclosure** | Fuite de clé API | Critique | Moyen | PropertiesService + masquage logs | ✅ Mitigé |
| **Denial of Service** | Prompts > 100k tokens | Moyen | Moyen | enforcePromptLimit_() | ✅ Mitigé |
| **Elevation of Privilege** | Accès à des documents non autorisés | Élevé | Faible | ACLs Drive natives | ✅ Mitigé |

### 10.2 Analyse Détaillée : Information Disclosure

**Scénario d'attaque** :
1. Attaquant obtient accès aux logs Apps Script (ex: ancien développeur)
2. Logs contiennent la clé API en clair
3. Attaquant utilise la clé pour générer des documents à notre insu
4. Dépassement de quota → Service indisponible

**Mitigation 1 : PropertiesService** (voir section 6.3)

**Mitigation 2 : Masquage dans les Logs** (voir section 6.3)

**Mitigation 3 : Rotation de Clé** (procédure manuelle) :

```javascript
// Procédure de rotation (à exécuter tous les 3 mois)
function rotateApiKey() {
  // 1. Générer une nouvelle clé sur DeepSeek.com
  var newKey = 'sk-NOUVELLE_CLE_ICI';
  
  // 2. Enregistrer la nouvelle clé
  PropertiesService.getScriptProperties().setProperty('DEEPSEEK_API_KEY', newKey);
  
  // 3. Tester avec un appel
  var test = callLLM_('deepseek-chat', 'Test', 'Test', 0.7, {maxTokens: 10});
  
  if (test.success) {
    Logger.log('✅ Rotation réussie');
  } else {
    Logger.log('❌ Rotation échouée : %s', test.error);
    // Rollback vers l'ancienne clé si nécessaire
  }
}
```

---

## 11. Observabilité, Tests et FinOps

### 11.1 Journalisation Structurée (Google Sheets)

**Architecture** : Chaque génération déclenche l'écriture d'une ligne dans un Google Sheet dédié.

**Schéma de données** (23 colonnes) :

```javascript
const COST_LOG_HEADER = [
  'timestamp',           // Date/heure de la génération
  'entry_type',          // 'estimation' ou 'call'
  'model',               // 'deepseek-reasoner' ou 'deepseek-chat'
  'cache_hit',           // 'hit', 'miss' ou ''
  'input_tokens',        // Nombre de tokens en entrée
  'input_chars',         // Nombre de caractères en entrée
  'input_price_per_M',   // Prix par million de tokens (input)
  'input_cost_USD',      // Coût réel input en USD
  'output_tokens',       // Nombre de tokens en sortie
  'output_pages',        // Nombre de pages estimées
  'output_price_per_M',  // Prix par million de tokens (output)
  'output_cost_USD',     // Coût réel output en USD
  'total_USD',           // Coût total (input + output)
  'latency_ms',          // Latence de l'appel API
  'entrepriseNom',       // Nom du client (pour analyse)
  'titre',               // Titre du projet
  'thematique',          // Thématique (BTP, Industrie 4.0, etc.)
  'dureeProjet',         // Durée estimée du projet
  'journal_timestamp',   // Horodatage métier (si différent)
  'journal_type',        // Type de journal
  'journal_cours',       // Cours associé (contexte Icam)
  'automation_log',      // Log d'automatisation
  'llm_temperature',     // Température utilisée
  'llm_top_p',           // Top-P utilisé
  'llm_max_tokens'       // Max tokens utilisé
];
```

**Code Source (Code.js, lignes 1597-1621)** :

```javascript
function logApiUsage_(callResult, formData) {
  if (!callResult || !callResult.success) return { success: false };
  
  var pricing = DEEPSEEK_PRICING[callResult.model] || DEEPSEEK_PRICING[DEFAULT_DEEPSEEK_MODEL];
  
  return logCostEntry_({
    entryType: 'call',
    model: callResult.model,
    cacheHit: '',
    inputTokens: (callResult.usage && callResult.usage.prompt_tokens) || 0,
    inputChars: '',
    inputPrice: pricing.in_miss,
    inputCost: (callResult.cost && callResult.cost.inputUsd) || 0,
    outputTokens: (callResult.usage && callResult.usage.completion_tokens) || 0,
    outputPages: '',
    outputPrice: pricing.out,
    outputCost: (callResult.cost && callResult.cost.outputUsd) || 0,
    total: (callResult.cost && callResult.cost.totalUsd) || 0,
    latency: callResult.latencyMs || ''
  }, formData);
}
```

### 11.2 Analyse FinOps (Coûts Réels)

**Données collectées sur 6 mois** (127 générations) :

| Métrique | Valeur |
|----------|--------|
| **Coût moyen par génération** | 0.003$ |
| **Coût total (6 mois)** | 0.38$ |
| **Coût projeté (1 an, 1000 docs)** | 3$ |
| **Latence moyenne** | 42.3s |
| **Latence P95** | 67.8s |
| **Latence P99** | 89.1s |

**Distribution des modèles** :

```
deepseek-reasoner : 87% (qualité maximale)
deepseek-chat     : 13% (tests et briefs simples)
```

**Requête SQL d'analyse** (via Google BigQuery) :

```sql
SELECT 
  model,
  COUNT(*) as nb_generations,
  AVG(total_USD) as avg_cost,
  SUM(total_USD) as total_cost,
  AVG(latency_ms) / 1000 as avg_latency_sec
FROM `icam-propales.logs.cost_log`
WHERE entry_type = 'call'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 MONTH)
GROUP BY model
ORDER BY nb_generations DESC;
```

**Résultat** :

| model | nb_generations | avg_cost | total_cost | avg_latency_sec |
|-------|----------------|----------|------------|-----------------|
| deepseek-reasoner | 110 | 0.0032 | 0.35 | 44.2 |
| deepseek-chat | 17 | 0.0015 | 0.03 | 28.1 |

### 11.3 Tests & Garanties de Qualité

**Stratégie de test multi-niveaux** :

#### Tests Unitaires (Simulation Apps Script)

```javascript
// Test de la fonction computeBackoffDelayMs_
function testBackoffDelay() {
  var tests = [
    { attempt: 1, expected: 1000 },
    { attempt: 2, expected: 2000 },
    { attempt: 3, expected: 4000 },
    { attempt: 4, expected: 4000 }, // Capped à LLM_MAX_RETRIES
  ];
  
  tests.forEach(function(test) {
    var result = computeBackoffDelayMs_(test.attempt);
    if (result !== test.expected) {
      throw new Error('Test failed: attempt=' + test.attempt + ', expected=' + test.expected + ', got=' + result);
    }
  });
  
  Logger.log('✅ testBackoffDelay passed');
}

// Test de la validation de schéma
function testValidateDeepSeekSections() {
  // Cas valide
  var valid = {
    contexte: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    demarche: 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    phases: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco.',
    phrase: 'Duis aute irure dolor in reprehenderit in voluptate velit.'
  };
  
  try {
    validateDeepSeekSections_(valid);
    Logger.log('✅ testValidateDeepSeekSections (valid) passed');
  } catch (e) {
    throw new Error('Test failed: valid input rejected');
  }
  
  // Cas invalide : section trop courte
  var invalid = {
    contexte: 'OK',
    demarche: 'OK',
    phases: 'OK',
    phrase: 'OK'
  };
  
  try {
    validateDeepSeekSections_(invalid);
    throw new Error('Test failed: invalid input accepted');
  } catch (e) {
    if (e.code === 'INVALID_SECTIONS') {
      Logger.log('✅ testValidateDeepSeekSections (invalid) passed');
    } else {
      throw e;
    }
  }
}
```

#### Tests d'Intégration End-to-End

| Scénario | Condition | Résultat Attendu | Statut |
|----------|-----------|------------------|--------|
| **Nominal** | Brief valide 500 mots | Document généré < 60s | ✅ Pass |
| **Résilience** | Erreur 429 simulée | Retry automatique réussi | ✅ Pass |
| **Dégradation** | Prompt > 100k tokens | Blocage serveur avec message | ✅ Pass |
| **Concurrence** | 5 utilisateurs simultanés | Aucune corruption | ✅ Pass |

---

*[Suite et fin dans le fichier suivant]*
