/***** ===========================================================
 *  MSI Propales  WebApp 1-clic (DeepSeek)  v0.2.0 Toni
 *  - Color Mapping + [[placeholders]]
 *  - Anti-doublon clientNom/entrepriseNom (meme paragraphe)
 *  - Copie dans dossier Drive CIBLE
 *  - Nettoyage integral du surlignage
 *  - Estimateur DeepSeek + journalisation Google Sheet
 *  - Appel DeepSeek reel (cle stockee cote serveur)
 *  - Logo ICAM via data:URL (fetch + fallback embarque) + cache
 * ============================================================ *****/

// === CONFIG ===
const TEMPLATE_DOC_ID = "1syQF8bOYnU6sGOei8Co3r-BL4Aj-caDl6zKw7GcOT2I";
const DESTINATION_FOLDER_ID = "1uK3jwE3CSq-wxBMweMVWyARGut0YITdJ";
const UX_SUPPRESS_COMPANY_AFTER_CONTACT = true;
const PROMPT_VERSION_TAG = "v2024.11"; // FIX: Ajout d'un identifiant de version pour tracer le prompt côté document final.
const PROMPT_TOKEN_LIMIT = 100000; // FIX: Limite serveur pour bloquer les prompts trop longs avant l'appel DeepSeek.
const MIN_SECTION_CHAR_LENGTH = 50; // FIX: Longueur minimale exigée par section JSON pour éviter les réponses vides.
const LLM_MAX_RETRIES = 3; // FIX: Nombre maximal de tentatives pour la stratégie de retry exponentiel DeepSeek.
const LLM_BACKOFF_BASE_MS = 1000; // FIX: Base en millisecondes pour l'attente exponentielle 1s/2s/4s lors des erreurs réseau.

function safeMoveFileToFolder_(fileId, folderId) {
  if (!fileId || !folderId) return;
  try {
    var folder = DriveApp.getFolderById(folderId);
    var file = DriveApp.getFileById(fileId);
    folder.addFile(file);
    var parents = file.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() !== folderId) {
        parent.removeFile(file);
      }
    }
  } catch (err) {
    Logger.log('⚠️ Impossible de déplacer le fichier %s: %s', fileId, err);
  }
}

function maskApiKeyForLog_(key) { // FIX: Ajout d'un utilitaire pour masquer la clé API dans les journaux Apps Script.
  if (!key) return "[REDACTED]"; // FIX: Retourne un placeholder si la clé est absente afin d'éviter toute fuite.
  if (String(key).length <= 8) return "[REDACTED]"; // FIX: Gère aussi les clés trop courtes pour empêcher leur affichage intégral.
  return String(key).substring(0, 4) + "…[REDACTED]"; // FIX: Ne journalise qu'un préfixe inoffensif suivi d'une mention redacted.
} // FIX: Fin du masquage de clé API destiné aux logs.

function computeBackoffDelayMs_(attempt) { // FIX: Calcule la durée d'attente exponentielle requise pour les retries DeepSeek.
  var safeAttempt = Math.max(1, Math.min(attempt, LLM_MAX_RETRIES)); // FIX: Empêche les valeurs hors borne afin de garder 1s/2s/4s.
  return Math.pow(2, safeAttempt - 1) * LLM_BACKOFF_BASE_MS; // FIX: Produit le délai exponentiel attendu par la stratégie de retry.
} // FIX: Termine le calculateur de backoff exponentiel.

function enforcePromptLimit_(systemPrompt, userPrompt) { // FIX: Vérifie côté serveur que le prompt reste sous la limite DeepSeek.
  var approxTokens = tokensApprox((systemPrompt || "").length + (userPrompt || "").length); // FIX: Approxime les tokens pour anticiper un dépassement API.
  if (approxTokens > PROMPT_TOKEN_LIMIT) { // FIX: Détecte les prompts trop volumineux avant l'appel DeepSeek.
    return { allowed: false, tokens: approxTokens, error: "Brief trop long (~" + approxTokens + " tokens). Réduisez le prompt." }; // FIX: Remonte une erreur explicite réutilisable côté UI.
  } // FIX: Fin de la clause de blocage pour les prompts excessifs.
  return { allowed: true, tokens: approxTokens }; // FIX: Retourne l'autorisation ainsi que l'estimation en tokens.
} // FIX: Termine le garde-fou de taille de prompt serveur.

function extractJsonFromString_(raw) { // FIX: Ajoute un extracteur JSON pour nettoyer les réponses LLM.
  if (!raw || typeof raw !== 'string') return null; // FIX: Retourne null si l'entrée est invalide.
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```|(\{[\s\S]*\})/); // FIX: Cherche un bloc de code JSON ou un objet JSON.
  return match ? (match[1] || match[2] || null) : null; // FIX: Retourne le contenu JSON trouvé ou null.
} // FIX: Fin de l'extracteur JSON.

function validateDeepSeekSections_(rawSections) { // FIX: Ajoute une validation stricte des sections JSON attendues.
  if (!rawSections || typeof rawSections !== "object") { // FIX: Refuse toute réponse qui n'est pas un objet JSON exploitable.
    var typeErr = new Error("Réponse DeepSeek invalide: objet JSON attendu."); // FIX: Crée une erreur explicite pour guider l'utilisateur.
    typeErr.code = "INVALID_SECTIONS"; // FIX: Fournit un code exploitable par le front pour contextualiser l'erreur.
    throw typeErr; // FIX: Stoppe le flux si la structure de base n'est pas correcte.
  } // FIX: Fin de la vérification du type de l'objet JSON.
  var required = ["contexte", "demarche", "phases", "phrase"]; // FIX: Liste des sections obligatoires demandées par le cahier des charges.
  var normalized = {}; // FIX: Prépare un objet nettoyé pour éviter les falsy inattendus.
  required.forEach(function (field) { // FIX: Boucle sur chaque section afin d'assurer une validation uniforme.
    var value = rawSections[field]; // FIX: Récupère la valeur brute renvoyée par l'IA.
    if (typeof value !== "string") { // FIX: Vérifie que chaque section soit textuelle.
      var missingErr = new Error("Section manquante ou mal typée: " + field + "."); // FIX: Prépare un message ciblé lorsque la section est absente.
      missingErr.code = "INVALID_SECTIONS"; // FIX: Associe le même code d'erreur pour faciliter le traitement client.
      throw missingErr; // FIX: Interrompt la génération si une section ne respecte pas le format attendu.
    } // FIX: Fin du contrôle de type string sur la section.
    var trimmed = value.trim(); // FIX: Nettoie les espaces parasites afin de mesurer une longueur pertinente.
    if (trimmed.length < MIN_SECTION_CHAR_LENGTH) { // FIX: Applique le seuil de contenu minimal pour éviter les réponses creuses.
      var shortErr = new Error("Section " + field + " trop courte (<" + MIN_SECTION_CHAR_LENGTH + " caractères)."); // FIX: Informe précisément l'utilisateur du champ insuffisant.
      shortErr.code = "INVALID_SECTIONS"; // FIX: Garde la cohérence des codes d'erreur pour ces validations.
      throw shortErr; // FIX: Bloque la génération tant que le contenu n'est pas suffisamment étoffé.
    } // FIX: Fin du contrôle de longueur minimale.
    normalized[field] = trimmed; // FIX: Enregistre la version nettoyée pour l'injection dans le template.
  }); // FIX: Termine la boucle de validation des sections.
  return normalized; // FIX: Retourne des sections sûres pour la suite du workflow.
} // FIX: Clôture de la validation structurée du JSON DeepSeek.

function appendGenerationMetadata_(docId, metadata) { // FIX: Ajoute une trace du modèle et de la version de prompt dans le document final.
  try { // FIX: Utilise un bloc try/catch pour ne pas bloquer la génération si l'ajout échoue.
    var doc = DocumentApp.openById(docId); // FIX: Récupère le document cible afin d'insérer la métadonnée.
    var footer = doc.getFooter(); // FIX: Préfère insérer les informations en pied de page.
    if (!footer && doc.addFooter) footer = doc.addFooter(); // FIX: Crée un footer si le template n'en fournit pas.
    var target = footer || doc.getBody(); // FIX: Fallback vers le corps si un footer reste indisponible.
    var stamp = Utilities.formatDate(metadata.generatedAt || new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"); // FIX: Formate la date de génération pour audit.
    var line = "Généré avec " + (metadata.model || "DeepSeek") + " · " + stamp + " · Prompt " + (metadata.promptVersion || "—"); // FIX: Compose la chaîne lisible réclamée par les consignes.
    var para = target.appendParagraph(line); // FIX: Insère le texte dans le document final.
    para.setForegroundColor("#666666"); // FIX: Rend la mention discrète mais lisible.
    para.setFontSize(8); // FIX: Réduit la taille pour ne pas gêner la lecture de la propale.
    doc.saveAndClose(); // FIX: Sauvegarde le document après insertion.
    return { success: true, text: line }; // FIX: Retourne le statut pour traçage côté appelant.
  } catch (err) { // FIX: Capture toute erreur d'accès DocumentApp.
    Logger.log("⚠️ Impossible d'ajouter la métadonnée de génération: %s", err); // FIX: Journalise l'incident sans divulguer d'informations sensibles.
    return { success: false, error: String(err) }; // FIX: Signale l'échec à l'appelant pour diagnostic.
  } // FIX: Termine le bloc try/catch d'ajout de métadonnée.
} // FIX: Fin de l'utilitaire d'annotation des documents générés.

// Mapping champ -> couleur
const COLOR_MAPPING = {
  thematique: "#F4CCCC",
  titre: "#E06666",
  codeProjet: "#C27BA0",
  dateDebut: "#FFF2CC",
  versionDoc: "#A2C4C9",
  clientNom: "#D9EAD3",
  clientFonction: "#FCE5CD",
  clientEmail: "#E6B8AF",
  clientTelephone: "#EAD1DC",
  entrepriseNom: "#FFFF00",
  entrepriseAdresse: "#C9DAF8",
  entrepriseLogo: "#D9D9D9",
  dureeProjet: "#3D85C6",
  contexte: "#A64D79",
  demarche: "#76A5AF",
  phases: "#8E7CC3",
  phrase: "#F6B26B",
  deepseekModel: "#9DC3E6",
  llmTemperature: "#F4B183",
  llmTopP: "#B4C7E7",
  llmMaxTokens: "#A9D18E",
  journalHorodatage: "#CFE2F3",
  journalType: "#F9CB9C",
  journalCours: "#D5A6BD",
  log: "#B6D7A8",
};

// === utils mapping (2 sens) ===
function normalizeColorHex(c) {
  if (!c) return null;
  c = String(c).toUpperCase();
  if (c.length > 7) c = c.slice(0, 7);
  return c;
}
function buildMaps_(raw) {
  var colorToField = {};
  var fieldToColor = {};
  Object.keys(raw || {}).forEach(function (k) {
    if (k && k.toString().charAt(0) === "#") {
      var color = normalizeColorHex(k);
      var field = String(raw[k]);
      colorToField[color] = field;
      fieldToColor[field] = color;
    } else {
      var field2 = k;
      var color2 = normalizeColorHex(raw[k]);
      if (color2) {
        colorToField[color2] = field2;
        fieldToColor[field2] = color2;
      }
    }
  });
  return { colorToField: colorToField, fieldToColor: fieldToColor };
}
var MAPS = buildMaps_(COLOR_MAPPING);

// === Normalisation & diagnostics ===
function normalizeTemplateValue_(field, value) {
  if (field === "entrepriseLogo") {
    return value || "";
  }
  if (value === null || value === undefined || value === "") {
    return "À compléter";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
}

function normalizeUpdatesObject_(updates) {
  var normalized = {};
  Object.keys(updates || {}).forEach(function (field) {
    normalized[field] = normalizeTemplateValue_(field, updates[field]);
  });
  return normalized;
}

function logReplacementStats_(docId, stats) {
  if (!stats) return;
  Logger.log("📄 applyUpdatesToDoc_ %s — statistiques de remplacement:", docId);
  Object.keys(stats).forEach(function (field) {
    var detail = stats[field];
    Logger.log(
      "  • %s: %s occurrence(s) -> %s",
      field,
      detail.occurrences,
      detail.valuePreview
    );
  });
}

function collectPlaceholderMatches_(text) {
  if (!text) return [];
  var matches = text.match(/\{\{[^\}]+\}\}|\[\[[^\]]+\]\]/g);
  return matches ? matches : [];
}

function replaceResidualPlaceholders_(containers) {
  var total = 0;
  var pattern = /\{\{([^\}]+)\}\}/g;
  containers.forEach(function (container) {
    if (!container || !container.getText) return;
    var text = container.getText();
    var matches = text.match(pattern);
    if (matches && matches.length) {
      container.replaceText("\\{\\{([^\\}]+)\\}\\}", "À compléter");
      total += matches.length;
    }
  });
  return total;
}

function normalizeTextColors_(container) {
  var updated = 0;
  function walk(node) {
    if (!node) return;
    if (node.getType && node.getType() === DocumentApp.ElementType.TEXT) {
      var textEl = node.asText();
      var len = textEl.getText().length;
      for (var i = 0; i < len; i++) {
        var color = normalizeColorHex(textEl.getForegroundColor(i));
        if (color && color !== "#000000") {
          try {
            textEl.setForegroundColor(i, i, "#000000");
            updated++;
          } catch (_) {}
        }
      }
    }
    if (node.getNumChildren) {
      for (var c = 0; c < node.getNumChildren(); c++) {
        walk(node.getChild(c));
      }
    }
  }
  walk(container);
  return updated;
}

function deduplicateParagraphs_(body) {
  if (!body) return { removed: 0, duplicates: [] };
  var seen = {};
  var removed = 0;
  var duplicates = [];
  var paragraphs = body.getParagraphs();
  for (var i = paragraphs.length - 1; i >= 0; i--) {
    var para = paragraphs[i];
    var text = para.getText().trim();
    if (!text) continue;
    if (text.length < 25) continue; // éviter les listes courtes légitimes
    var key = text.replace(/\s+/g, " ");
    if (seen[key]) {
      duplicates.push(text);
      para.removeFromParent();
      removed++;
    } else {
      seen[key] = true;
    }
  }
  return { removed: removed, duplicates: duplicates };
}

function collectRemainingPlaceholders_(containers) {
  var leftover = [];
  containers.forEach(function (container) {
    if (!container || !container.getText) return;
    leftover = leftover.concat(collectPlaceholderMatches_(container.getText()));
  });
  return leftover;
}

function finalizeProposalDocument_(docId) {
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody();
  if (!body) {
    return { success: false, error: "Document sans corps" };
  }
  var containers = [body];
  var header = doc.getHeader();
  var footer = doc.getFooter();
  if (header) containers.push(header);
  if (footer) containers.push(footer);

  var replacedPlaceholders = replaceResidualPlaceholders_(containers);
  if (replacedPlaceholders > 0) {
    Logger.log(
      "🧹 %s placeholder(s) résiduel(s) converti(s) en 'À compléter'.",
      replacedPlaceholders
    );
  }

  var normalizedChars = 0;
  containers.forEach(function (container) {
    normalizedChars += normalizeTextColors_(container);
  });
  if (normalizedChars > 0) {
    Logger.log(
      "🎨 Normalisation couleur: %s caractère(s) repassé(s) en noir.",
      normalizedChars
    );
  }

  var dedupStats = deduplicateParagraphs_(body);
  if (dedupStats.removed > 0) {
    Logger.log(
      "♻️ Paragraphes dupliqués supprimés: %s",
      dedupStats.removed
    );
    dedupStats.duplicates.slice(0, 5).forEach(function (txt) {
      Logger.log("   - %s", txt.substring(0, 120));
    });
  }

  var leftovers = collectRemainingPlaceholders_(containers);
  if (leftovers.length) {
    Logger.log(
      "⚠️ Variables non remplacées détectées: %s",
      leftovers.join(", ")
    );
  }

  doc.saveAndClose();
  return {
    success: true,
    stats: {
      replacedPlaceholders: replacedPlaceholders,
      normalizedChars: normalizedChars,
      duplicatesRemoved: dedupStats.removed,
      leftoverPlaceholders: leftovers,
    },
  };
}

function exportProposalPdf_(docId, options) {
  options = options || {};
  try {
    var originalFile = DriveApp.getFileById(docId);
    var tempCopy = originalFile.makeCopy(originalFile.getName() + "_PDF_PREP");
    var tempDoc = DocumentApp.openById(tempCopy.getId());
    var header = tempDoc.getHeader();
    if (header) header.clear();
    var footer = tempDoc.getFooter();
    if (footer) footer.clear();
    tempDoc.saveAndClose();

    var pdfBlob = tempCopy.getAs(MimeType.PDF);
    var folder = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
    var pdfName =
      (options.fileName || originalFile.getName())
        .replace(/\.pdf$/i, "") + ".pdf";
    var pdfFile = folder.createFile(pdfBlob).setName(pdfName.trim());
    tempCopy.setTrashed(true);
    Logger.log(
      "📦 Export PDF généré: %s (%s)",
      pdfFile.getName(),
      pdfFile.getUrl()
    );
    return {
      success: true,
      fileId: pdfFile.getId(),
      url: pdfFile.getUrl(),
      name: pdfFile.getName(),
    };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// === DeepSeek (API & journal) ===
const PROP_DEEPSEEK_API_KEY = "DEEPSEEK_API_KEY";
const PROP_COST_SHEET_PROPKEY = "COST_SHEET_ID";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODELS = [
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner (raisonnement)" },
  { id: "deepseek-chat", label: "DeepSeek Chat (rapide)" },
];
const DEFAULT_DEEPSEEK_MODEL = "deepseek-reasoner";
const DEEPSEEK_PRICING = {
  "deepseek-reasoner": { in_hit: 0.14, in_miss: 0.55, out: 2.19 },
  "deepseek-chat": { in_hit: 0.07, in_miss: 0.27, out: 1.1 },
};
const ONE_MILLION = 1000000;
const COST_LOG_HEADER = [
  "timestamp",
  "entry_type",
  "model",
  "cache_hit",
  "input_tokens",
  "input_chars",
  "input_price_per_M",
  "input_cost_USD",
  "output_tokens",
  "output_pages",
  "output_price_per_M",
  "output_cost_USD",
  "total_USD",
  "latency_ms",
  "entrepriseNom",
  "titre",
  "thematique",
  "dureeProjet",
  "journal_timestamp",
  "journal_type",
  "journal_cours",
  "automation_log",
  "llm_temperature",
  "llm_top_p",
  "llm_max_tokens",
];

// === WebApp ===
function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("MSI Propales")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function getSettings() {
  return {
    models: DEEPSEEK_MODELS,
    pricing: DEEPSEEK_PRICING,
    hasKey: hasApiKey().hasKey,
    defaultModel: DEFAULT_DEEPSEEK_MODEL,
  };
}

function requireApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty(
    PROP_DEEPSEEK_API_KEY
  );
  if (!key) throw new Error("Aucune cle API DeepSeek nest enregistree.");
  return key;
}

function resolveDeepseekModel_(candidate) {
  if (candidate && DEEPSEEK_PRICING[candidate]) return candidate;
  return DEFAULT_DEEPSEEK_MODEL;
}

// === LLM (DeepSeek) ===
function callLLM_(provider, prompt, systemPrompt, temperature, options) {
  var model = resolveDeepseekModel_(
    (options && options.model) ||
      (provider && DEEPSEEK_PRICING[provider] ? provider : null)
  );

  var key;
  try {
    key = requireApiKey_();
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }

  var payload = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt || "" },
      { role: "user", content: prompt || "" },
    ],
    temperature: typeof temperature === "number" ? temperature : 0.7,
    max_tokens: options && options.maxTokens ? options.maxTokens : 900,
  };

  Logger.log(
    "🚀 DeepSeek payload — model: %s, temperature: %s, max_tokens: %s",
    model,
    payload.temperature,
    payload.max_tokens
  );
  Logger.log(
    "   • System prompt: %s",
    (systemPrompt || "").substring(0, 300)
  );
  Logger.log("   • User prompt: %s", (prompt || "").substring(0, 300));

  if (options && typeof options.topP === "number" && !isNaN(options.topP)) {
    var safeTopP = Math.min(1, Math.max(0, options.topP));
    payload.top_p = safeTopP;
  }

  var fetchOptions = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var sanitizedHeadersForLog = { Authorization: "Bearer " + maskApiKeyForLog_(key) }; // FIX: Journalise les en-têtes sans exposer la clé API réelle.
  Logger.log("🔐 DeepSeek headers (masqués): %s", JSON.stringify(sanitizedHeadersForLog)); // FIX: Trace l'appel en respectant l'instruction de masquage de la clé API.

  var resp = null; // FIX: Prépare la réponse HTTP pour la boucle de retry.
  var latencyMs = 0; // FIX: Stocke la latence finale du dernier appel réussi.
  var callStartedAt = Date.now(); // FIX: Point de départ pour mesurer la latence multi-tentatives.

  for (var attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) { // FIX: Implémente la stratégie de retry exponentiel demandée.
    Logger.log("🔁 Tentative DeepSeek %s/%s", attempt, LLM_MAX_RETRIES); // FIX: Journalise chaque tentative pour faciliter le diagnostic réseau.
    try {
      resp = UrlFetchApp.fetch(DEEPSEEK_BASE_URL, fetchOptions); // FIX: Exécute la requête DeepSeek avec reprise possible.
    } catch (err) {
      Logger.log("⚠️ Tentative DeepSeek échouée (exception): %s", err); // FIX: Trace immédiatement les erreurs réseau ou DNS.
      if (attempt < LLM_MAX_RETRIES) { // FIX: On ne bloque pas tant qu'il reste des tentatives disponibles.
        var waitForNetwork = computeBackoffDelayMs_(attempt); // FIX: Calcule l'attente exponentielle entre les essais.
        Utilities.sleep(waitForNetwork); // FIX: Applique le backoff demandé (1s/2s/4s).
        continue; // FIX: Passe à la tentative suivante après la pause.
      }
      return { success: false, error: "DeepSeek injoignable: " + String(err), code: "NETWORK" }; // FIX: Remonte une erreur claire lorsque toutes les tentatives réseau échouent.
    }

    var status = resp.getResponseCode(); // FIX: Capture le code HTTP pour décider d'un retry ou d'un message spécifique.
    var body = resp.getContentText(); // FIX: Stocke le corps brut pour l'analyse JSON ou l'affichage d'erreur.

    if (status >= 200 && status < 300) { // FIX: Succès HTTP, fin de la boucle de retry.
      latencyMs = Date.now() - callStartedAt; // FIX: Calcule la latence cumulée réelle de l'appel final.
      var json; // FIX: Prépare la variable qui recevra la réponse JSON parsée.
      try {
        json = JSON.parse(body); // FIX: Parse la réponse DeepSeek maintenant que le statut est OK.
      } catch (err) {
        return { success: false, error: "Réponse DeepSeek invalide: " + String(err.message || err), code: "INVALID_RESPONSE" }; // FIX: Intercepte les JSON mal formés pour éviter de casser le flux.
      }

      var content =
        (json.choices &&
          json.choices[0] &&
          json.choices[0].message &&
          json.choices[0].message.content) ||
        "";
      if (!content) {
        return { success: false, error: "Reponse DeepSeek vide.", code: "EMPTY_CONTENT" }; // FIX: Détecte explicitement les réponses sans texte utile.
      }

      var usage = json.usage || {}; // FIX: Préserve le calcul du coût sur la réponse réussie.
      var cost = calculateUsageCost_(usage, model); // FIX: Conserve la logique tarifaire existante sur le nouveau flux.

      return {
        success: true,
        content: content,
        raw: json,
        usage: usage,
        cost: cost,
        model: model,
        latencyMs: latencyMs,
      };
    }

    var shouldRetry = status === 500 || status === 502 || status === 503; // FIX: Détermine quels codes méritent un retry automatique.
    if (shouldRetry && attempt < LLM_MAX_RETRIES) { // FIX: N'attend qu'en cas d'erreur transitoire avec tentatives restantes.
      var waitForStatus = computeBackoffDelayMs_(attempt); // FIX: Calcule la pause avant la prochaine tentative.
      Logger.log("⏳ DeepSeek HTTP %s, nouvelle tentative dans %sms", status, waitForStatus); // FIX: Rend visible le comportement du backoff dans les logs Apps Script.
      Utilities.sleep(waitForStatus); // FIX: Applique effectivement le délai exponentiel pour éviter le rate limiting.
      continue; // FIX: Essaie à nouveau après la pause si les conditions le permettent.
    }

    var friendlyMessage = "DeepSeek HTTP " + status + ": " + body; // FIX: Prépare un message par défaut si aucun cas spécial n'est détecté.
    var errorCode = "HTTP_ERROR"; // FIX: Associe un code d'erreur générique pour les analyses côté UI.
    var retryAfterMs = 0; // FIX: Permet de transmettre un délai conseillé aux utilisateurs.
    if (status === 429) { // FIX: Cas quota dépassé/rate limiting DeepSeek.
      friendlyMessage = "Quota DeepSeek dépassé. Réessayez dans 1 minute."; // FIX: Message utilisateur explicite demandé.
      errorCode = "RATE_LIMIT"; // FIX: Facilite le traitement côté interface pour afficher un bouton de retry adapté.
      retryAfterMs = 60000; // FIX: Suggestion d'attente d'une minute en cohérence avec les instructions.
    } else if (status === 402) { // FIX: Cas quota de paiement DeepSeek épuisé.
      friendlyMessage = "Crédits DeepSeek insuffisants (402)."; // FIX: Indique clairement le dépassement de budget/quota.
      errorCode = "PAYMENT_REQUIRED"; // FIX: Permet d'identifier l'action corrective côté utilisateur.
    } else if (status === 503 || status === 500 || status === 502) { // FIX: Cas de panne ou indisponibilité serveur DeepSeek.
      friendlyMessage = "DeepSeek indisponible. Merci de réessayer ultérieurement."; // FIX: Message orienté fallback pour informer l'utilisateur.
      errorCode = "OFFLINE"; // FIX: Drapeau pour activer le mode retry côté UI.
      retryAfterMs = computeBackoffDelayMs_(attempt); // FIX: Recommande un délai identique au backoff appliqué.
    }
    return { success: false, error: friendlyMessage, code: errorCode, status: status, retryAfterMs: retryAfterMs, body: body }; // FIX: Remonte un objet riche en métadonnées d'erreur vers le front.
  }

  return { success: false, error: "DeepSeek injoignable malgré retries.", code: "NETWORK" }; // FIX: Garde un garde-fou si, par sécurité, la boucle sort sans retour.
}

function callDeepSeek(payload) {
  var opts = payload || {};
  var maxTokens =
    typeof opts.max_tokens === "number" && opts.max_tokens > 0
      ? opts.max_tokens
      : 900;
  var chosenModel = resolveDeepseekModel_(opts.model);
  var llm = callLLM_(
    chosenModel,
    opts.user,
    opts.system,
    typeof opts.temperature === "number" ? opts.temperature : 0.7,
    { maxTokens: maxTokens, model: chosenModel }
  );
  if (!llm.success) {
    throw new Error(llm.error || "Echec DeepSeek.");
  }
  return {
    ok: true,
    model: llm.model,
    text: llm.content,
    usage: llm.usage,
    cost: llm.cost,
    latency_ms: llm.latencyMs,
    raw: llm.raw,
  };
}

function calculateUsageCost_(usage, model) {
  var pricing =
    DEEPSEEK_PRICING[model] || DEEPSEEK_PRICING[DEFAULT_DEEPSEEK_MODEL];
  var prompt = usage && usage.prompt_tokens ? usage.prompt_tokens : 0;
  var completion =
    usage && usage.completion_tokens ? usage.completion_tokens : 0;
  var inputUsd = (prompt * pricing.in_miss) / ONE_MILLION;
  var outputUsd = (completion * pricing.out) / ONE_MILLION;
  return {
    inputUsd: round4(inputUsd),
    outputUsd: round4(outputUsd),
    totalUsd: round4(inputUsd + outputUsd),
  };
}

// === Warmup (optionnel) ===
function warmupAuth() {
  DriveApp.getRootFolder();
  if (TEMPLATE_DOC_ID && TEMPLATE_DOC_ID.indexOf("<<") === -1) {
    DocumentApp.openById(TEMPLATE_DOC_ID).getName();
  }
  return "OK";
}

function getIcamLogoDataUrl() {
  const LOGO_URL = "https://www.icam.fr/wp-content/uploads/2017/08/logo-icam-2.png";
  const CACHE_KEY = "ICAM_LOGO_DATA_URL_V3";
  const cache = CacheService.getScriptCache();

  try {
    const cachedDataUrl = cache.get(CACHE_KEY);
    if (cachedDataUrl) {
      return cachedDataUrl;
    }

    const imageBlob = UrlFetchApp.fetch(LOGO_URL).getBlob();
    const contentType = imageBlob.getContentType();
    if (!contentType || !contentType.startsWith("image/")) {
       throw new Error("URL did not return a valid image. Content-Type: " + contentType);
    }

    const base64Data = Utilities.base64Encode(imageBlob.getBytes());
    const dataUrl = "data:" + contentType + ";base64," + base64Data;

    cache.put(CACHE_KEY, dataUrl, 3600 * 6); // Cache for 6 hours
    return dataUrl;
  } catch (e) {
    console.error("Failed to fetch and encode Icam logo from " + LOGO_URL + ". Error: " + e.toString());
    // In case of failure, return an empty string. The client-side has a fallback mechanism.
    return "";
  }
}

function createTemplateCopy(entrepriseNom) {
  try {
    if (!TEMPLATE_DOC_ID || TEMPLATE_DOC_ID.indexOf("<<") === 0) {
      throw new Error("TEMPLATE_DOC_ID nest pas renseigne dans Code.gs.");
    }
    var folder = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
    var tpl = DriveApp.getFileById(TEMPLATE_DOC_ID);
    var ts = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd_HH-mm"
    );
    var name = (
      "Proposition_" +
      (entrepriseNom || "Client") +
      "_" +
      ts
    ).replace(/[^a-zA-Z0-9_-]/g, "_");
    var copy = tpl.makeCopy(name, folder);
    return {
      success: true,
      documentId: copy.getId(),
      url: "https://docs.google.com/document/d/" + copy.getId() + "/edit",
    };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

function createConsoleTranscriptDocument_(rawContent, sections, formData, model) {
  if (!rawContent) {
    return { success: false, error: 'Aucun contenu IA à archiver.' };
  }
  try {
    var folderId = DESTINATION_FOLDER_ID;
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    var baseName = [
      'Console',
      formData && formData.entrepriseNom ? formData.entrepriseNom : 'Client',
      ts,
    ]
      .join('_')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    var doc = DocumentApp.create(baseName);
    var body = doc.getBody();
    if (body) {
      body.clear();
      body.appendParagraph('Transcript brut DeepSeek').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      var meta = [];
      if (formData && formData.titre) meta.push('Titre : ' + formData.titre);
      if (formData && formData.entrepriseNom) meta.push('Entreprise : ' + formData.entrepriseNom);
      if (formData && formData.thematique) meta.push('Thématique : ' + formData.thematique);
      meta.push('Modèle IA : ' + (model || 'DeepSeek'));
      meta.push('Horodatage : ' + ts);
      body.appendParagraph(meta.join(' · ')).setForegroundColor('#666666');
      if (sections && typeof sections === 'object') {
        body.appendParagraph('Sections interprétées').setHeading(DocumentApp.ParagraphHeading.HEADING2);
        ['contexte', 'demarche', 'phases', 'phrase'].forEach(function (key) {
          if (!sections[key]) return;
          body.appendParagraph(key.toUpperCase()).setHeading(DocumentApp.ParagraphHeading.HEADING3);
          body.appendParagraph(String(sections[key]));
        });
      }
      body.appendParagraph('Réponse JSON brute').setHeading(DocumentApp.ParagraphHeading.HEADING2);
      var pre = body.appendParagraph(String(rawContent));
      pre.setFontFamily('Roboto Mono');
      pre.setFontSize(10);
    }
    safeMoveFileToFolder_(doc.getId(), folderId);
    return {
      success: true,
      documentId: doc.getId(),
      url: 'https://docs.google.com/document/d/' + doc.getId() + '/edit',
    };
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
}

function applyUpdatesToDoc_(docId, updates, options) {
  options = options || {};
  var removeAllHighlight = options.removeAllHighlight !== false;

  var doc = DocumentApp.openById(docId);
  var containers = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(
    function (x) {
      return !!x;
    }
  );

  let regex = /[A-Z]/;

  function safeSetBg(textEl, from, to, color) {
    var len = textEl.getText().length;
    if (len === 0) return;
    from = Math.max(0, Math.min(from, len - 1));
    to = Math.max(0, Math.min(to, len - 1));
    if (to < from) return;
    textEl.setBackgroundColor(from, to, color);
  }
  function safeDelete(textEl, from, to) {
    var len = textEl.getText().length;
    if (len === 0) return;
    from = Math.max(0, Math.min(from, len - 1));
    to = Math.max(0, Math.min(to, len - 1));
    if (to < from) return;
    textEl.deleteText(from, to);
  }
  function safeInsert(textEl, at, str) {
    var insert = String(str);
    var len = textEl.getText().length;
    if (len === 0) {
      textEl.setText(insert);
      return;
    }
    if (at < 0) at = 0;
    if (at > len) at = len;
    if (at === len) textEl.appendText(insert);
    else textEl.insertText(at, insert);
  }

  var normalizedUpdates = normalizeUpdatesObject_(updates);
  var replacementStats = {};

  Object.keys(normalizedUpdates || {}).forEach(function (field) {
    var val = normalizedUpdates[field];
    var ph = "[[" + field + "]]";
    var patt = escRegex(ph);
    var isLogo =
      field === "entrepriseLogo" && /^https?:\/\//i.test(String(val || ""));

    containers.forEach(function (el) {
      if (!el) return;
      var r;
      var replacedHere = 0;
      while ((r = el.findText(patt))) {
        var e = r.getElement();
        if (!e || e.getType() !== DocumentApp.ElementType.TEXT) break;
        var t = e.asText();
        var s0 = r.getStartOffset();
        var e0 = r.getEndOffsetInclusive();
        try {
          safeSetBg(t, s0, e0, null);
        } catch (_) {}

        safeDelete(t, s0, e0);
        if (val != null && String(val).length) {
          if (isLogo) {
            try {
              var blob = UrlFetchApp.fetch(val, {
                muteHttpExceptions: true,
                followRedirects: true,
              }).getBlob();
              t.getParent()
                .asParagraph()
                .insertInlineImage(0, blob)
                .setWidth(120);
            } catch (err) {
              safeInsert(t, s0, String(val));
            }
          } else {
            safeInsert(t, s0, String(val));
          }
        }
        replacedHere++;
      }
      if (replacedHere > 0) {
        if (!replacementStats[field]) {
          replacementStats[field] = {
            occurrences: 0,
            valuePreview: String(val).substring(0, 80),
          };
        }
        replacementStats[field].occurrences += replacedHere;
      }
    });
  });

  logReplacementStats_(docId, replacementStats);

  function forEachParagraphTexts(fn) {
    containers.forEach(function (root) {
      if (!root) return;
      (function walk(node) {
        var type = node.getType ? node.getType() : null;
        if (type === DocumentApp.ElementType.PARAGRAPH) {
          var para = node.asParagraph();
          var texts = [];
          for (var i = 0; i < para.getNumChildren(); i++) {
            var ch = para.getChild(i);
            if (ch.getType() === DocumentApp.ElementType.TEXT)
              texts.push(ch.asText());
          }
          if (texts.length) fn(para, texts);
        } else if (node.getNumChildren) {
          for (var j = 0; j < node.getNumChildren(); j++)
            walk(node.getChild(j));
        }
      })(root);
    });
  }
  function colorAt(textEl, idx) {
    return normalizeColorHex(textEl.getBackgroundColor(idx));
  }
  function isWs(ch) {
    return !ch || /\s/.test(ch);
  }
  function prevChar(texts, tIdx, off) {
    if (off > 0) return texts[tIdx].getText().charAt(off - 1) || "";
    if (tIdx > 0) {
      var s = texts[tIdx - 1].getText();
      return s ? s.charAt(s.length - 1) : "";
    }
    return "";
  }
  var PUNCT_RE = /^[\s\.,;:!\?\(\)"'\\\-]*$/;
  function isOnlyWhitespaceBetween(texts, t1, off1, t2, off2) {
    if (t1 === -1) return false;
    if (t1 === t2) {
      var seg1 = texts[t1].getText().substring(off1, off2);
      return PUNCT_RE.test(seg1);
    }
    var seg = texts[t1].getText().substring(off1);
    for (var k = t1 + 1; k < t2; k++) seg += texts[k].getText();
    seg += texts[t2].getText().substring(0, off2);
    return PUNCT_RE.test(seg);
  }
  function deleteOneSpaceBefore(texts, tIdx, off) {
    if (off > 0) {
      var t = texts[tIdx];
      var ch = t.getText().charAt(off - 1) || "";
      if (/\s/.test(ch)) safeDelete(t, off - 1, off - 1);
    } else if (tIdx > 0) {
      var p = texts[tIdx - 1];
      var s = p.getText();
      if (s && /\s/.test(s.charAt(s.length - 1)))
        safeDelete(p, s.length - 1, s.length - 1);
    }
  }

  forEachParagraphTexts(function (para, texts) {
    var lastField = null;
    var lastT = -1,
      lastEnd = -1;

    for (var tIdx = 0; tIdx < texts.length; tIdx++) {
      var textEl = texts[tIdx];
      var i = 0;
      while (true) {
        var lenNow = textEl.getText().length;
        if (lenNow === 0 || i >= lenNow) break;

        var bg = colorAt(textEl, i);
        var field = MAPS.colorToField[bg];
        if (!field) {
          i++;
          continue;
        }

        var j = i + 1;
        while (j < lenNow && colorAt(textEl, j) === bg) j++;

        var before = prevChar(texts, tIdx, i);
        if (!isWs(before)) {
          safeInsert(textEl, i, " ");
          i++;
          j++;
        }

        if (
          UX_SUPPRESS_COMPANY_AFTER_CONTACT &&
          field === "entrepriseNom" &&
          lastField === "clientNom"
        ) {
          var onlyWs = isOnlyWhitespaceBetween(
            texts,
            lastT,
            lastEnd + 1,
            tIdx,
            i
          );
          if (onlyWs) {
            var distance = (function () {
              if (lastT === -1) return 999;
              if (lastT === tIdx) return i - (lastEnd + 1);
              return 1;
            })();
            if (distance <= 2) {
              deleteOneSpaceBefore(texts, tIdx, i);
              safeDelete(textEl, i, j - 1);
              lastField = "entrepriseNom";
              lastT = tIdx;
              lastEnd = i - 1;
              continue;
            }
          }
        }

        var val = normalizedUpdates[field];
        if (val != null && String(val).length) {
          var sVal = String(val);
          safeDelete(textEl, i, j - 1);
          safeInsert(textEl, i, sVal);
          if (sVal.length > 0)
            try {
              safeSetBg(textEl, i, i + sVal.length - 1, null);
            } catch (_) {}

          var afterIdx = i + sVal.length;
          var thisTxt = textEl.getText();
          if (afterIdx < thisTxt.length) {
            var nextColor = colorAt(textEl, afterIdx);
            if (nextColor && MAPS.colorToField[nextColor]) {
              var beforeNext = thisTxt.charAt(afterIdx - 1) || "";
              if (!isWs(beforeNext)) safeInsert(textEl, afterIdx, " ");
            }
          } else if (tIdx + 1 < texts.length) {
            var nextEl = texts[tIdx + 1];
            if (nextEl.getText().length > 0) {
              var nextColor2 = colorAt(nextEl, 0);
              if (nextColor2 && MAPS.colorToField[nextColor2])
                safeInsert(nextEl, 0, " ");
            }
          }

          lastField = field;
          lastT = tIdx;
          lastEnd = i + sVal.length - 1;
          i = lastEnd + 1;
        } else {
          safeDelete(textEl, i, j - 1);
          lastField = field;
          lastT = tIdx;
          lastEnd = i - 1;
        }
      }
    }
  });

  if (removeAllHighlight) {
    var known = Object.keys(MAPS.colorToField);
    (function clearAll() {
      function walkElm(el) {
        if (el.getType && el.getType() === DocumentApp.ElementType.TEXT) {
          var t = el.asText();
          var len = t.getText().length;
          for (var k = 0; k < len; k++) {
            var c = normalizeColorHex(t.getBackgroundColor(k));
            if (known.indexOf(c) !== -1) {
              try {
                safeSetBg(t, k, k, null);
              } catch (_) {}
            }
          }
        } else if (el.getNumChildren) {
          for (var i = 0; i < el.getNumChildren(); i++) walkElm(el.getChild(i));
        }
      }
      containers.forEach(walkElm);
    })();
  }

  doc.saveAndClose();
  return { success: true };
}

function generateFullProposal(formData) {
  try {
    var generationStartedAt = Date.now();
    if (!formData || !formData.titre || !formData.entrepriseNom) {
      return {
        success: false,
        error: "Titre et Entreprise sont obligatoires.",
      };
    }

    var brief = [
      "## Fiche de renseignements",
      "- **Entreprise cliente** : " + (formData.entrepriseNom || "Non spécifié"),
      "- **Problématique principale** : " + (formData.ia_probleme || "Non spécifié"),
      "- **Solution envisagée** : " + (formData.ia_solution || "Non spécifié"),
      "- **Objectifs du projet** : " + (formData.ia_objectifs || "Non spécifié"),
      "- **Thématique générale** : " + (formData.thematique || "Non spécifié"),
      "- **Durée estimée** : " + (formData.dureeProjet || "Non spécifié"),
    ].join("\n");

    var mandatoryForPrompt = [
      "entrepriseNom",
      "ia_probleme",
      "ia_solution",
      "ia_objectifs",
      "thematique",
      "dureeProjet",
    ];
    var missingForPrompt = mandatoryForPrompt.filter(function (key) {
      return !formData[key];
    });
    if (missingForPrompt.length) {
      Logger.log(
        "⚠️ Champs incomplets pour le prompt DeepSeek: %s",
        missingForPrompt.join(", ")
      );
    }

    var sys =
      "## Mission\n" +
      "Tu es un consultant senior de l'Icam, un expert en ingénierie et stratégie industrielle. Ta mission est de rédiger une proposition commerciale percutante et sur mesure en réponse à un brief client. Tu ne te contentes pas de reformuler ; tu enrichis, tu contextualises et tu apportes une réelle valeur ajoutée en te basant sur ton expertise.\n\n" +
      "## Directives Clés\n" +
      "1.  **Persona & Ton** : Incarne un expert confiant, stratégique et orienté solution. Le ton doit être professionnel, précis et valoriser l'approche Icam (rigueur, pragmatisme, innovation).\n" +
      "2.  **Format de Sortie Obligatoire** : Ta seule et unique réponse doit être un objet JSON valide. Aucun texte, commentaire ou markdown ne doit précéder ou suivre cet objet. La structure est non négociable : `{\"contexte\": \"...\", \"demarche\": \"...\", \"phases\": \"...\", \"phrase\": \"...\"}`.\n" +
      "3.  **Enrichissement du Contenu (Règle Critique)** : Ne te limite JAMAIS à une simple reformulation du brief. Utilise les informations fournies comme un tremplin. Approfondis chaque section avec des concepts d'ingénierie, des méthodologies reconnues (Lean, Six Sigma, Agile, etc. si pertinent) et des arguments stratégiques.\n" +
      "    -   `contexte` : Va au-delà de la description du problème. Replace-le dans un contexte stratégique plus large pour l'entreprise (compétitivité, transformation numérique, excellence opérationnelle). Montre que tu comprends les enjeux business derrière la demande technique.\n" +
      "    -   `demarche` : Ne liste pas seulement des actions. Présente une véritable méthodologie Icam. Structure ton approche, justifie tes choix (pourquoi cette méthode plutôt qu'une autre ?) et mets en avant les bénéfices attendus (efficacité, ROI, pérennité de la solution).\n" +
      "    -   `phases` : Décompose le projet en phases logiques et séquentielles. Pour chaque phase, définis clairement : l'**objectif**, les **livrables clés** et les **jalons de validation**. Sois concret et crédible. La structure doit inspirer confiance et montrer une maîtrise parfaite du déroulement projet.\n" +
      "    -   `phrase` : Conclus avec une phrase d'engagement puissante qui n'est pas une simple formule de politesse. Elle doit résumer la valeur ajoutée de l'Icam et ouvrir sur une collaboration fructueuse. Pense impact et partenariat.\n\n" +
      "## Exemple de Structure Attendue pour la section `phases`\n" +
      "Phase 1 : Audit & Diagnostic\n" +
      "*   Objectif : [...] \n" +
      "*   Livrables : Rapport d'audit, cartographie des flux VSM, recommandations chiffrées.\n" +
      "Phase 2 : Conception & Développement\n" +
      "*   Objectif : [...] \n" +
      "*   Livrables : Spécifications techniques, prototype fonctionnel, plan de déploiement.\n" +
      "Phase 3 : Déploiement & Suivi\n" +
      "*   Objectif : [...] \n" +
      "*   Livrables : Solution déployée, documentation utilisateur, KPIs de performance post-projet.";

    var user =
      "## Brief du projet\n" +
      brief +
      "\n\n" +
      "## Instruction\n" +
      "Génère le contenu des quatre sections (`contexte`, `demarche`, `phases`, `phrase`) en te basant sur le brief ci-dessus et tes connaissances du monde de l'ingénierie et du conseil. Retourne le résultat exclusivement au format JSON.";

    var promptGuard = enforcePromptLimit_(sys, user); // FIX: Applique la limite haute DeepSeek avant d'appeler le LLM.
    if (!promptGuard.allowed) { // FIX: Bloque immédiatement si plus de 100k tokens sont estimés.
      return { success: false, error: promptGuard.error, code: "PROMPT_TOO_LARGE", promptTokens: promptGuard.tokens }; // FIX: Retourne un message exploitable côté UI avec le nombre de tokens estimé.
    } // FIX: Fin de la surveillance de taille de prompt côté serveur.

    // ... dans function generateFullProposal(formData) ...
    var chosenModel = resolveDeepseekModel_(formData && formData.deepseekModel);

    var tempCandidate =
      typeof formData.llmTemperature === "number"
        ? formData.llmTemperature
        : parseFloat(formData.llmTemperature);
    var temp = 0.6;
    if (!isNaN(tempCandidate)) {
      temp = Math.min(2, Math.max(0, tempCandidate));
    }

    var maxTokCandidate =
      typeof formData.llmMaxTokens === "number"
        ? formData.llmMaxTokens
        : parseInt(formData.llmMaxTokens, 10);
    var maxTok = 1800;
    if (!isNaN(maxTokCandidate) && maxTokCandidate > 0) {
      maxTok = Math.min(4000, Math.max(200, maxTokCandidate));
    }

    var topPCandidate =
      typeof formData.llmTopP === "number"
        ? formData.llmTopP
        : parseFloat(formData.llmTopP);
    var topP = null;
    if (!isNaN(topPCandidate)) {
      topP = Math.min(1, Math.max(0, topPCandidate));
    }

    var llm = callLLM_(chosenModel, user, sys, temp, {
      model: chosenModel,
      maxTokens: maxTok,
      topP: topP,
    });
    if (!llm.success) return llm;

    var measuredLatency =
      llm && typeof llm.latencyMs === "number" && llm.latencyMs >= 0
        ? llm.latencyMs
        : Date.now() - generationStartedAt;
    llm.latencyMs = measuredLatency;

    var sections; // FIX: Variable destinée à contenir les sections DeepSeek validées.
    try {
      var jsonString = extractJsonFromString_(llm.content); // FIX: Extrait le JSON de la réponse brute.
      if (!jsonString) { // FIX: Gère le cas où aucun JSON n'est trouvé.
        var extractionErr = new Error("Aucun JSON valide trouvé dans la réponse IA."); // FIX: Crée une erreur explicite.
        extractionErr.code = "NO_JSON_FOUND"; // FIX: Ajoute un code pour le traitement client.
        throw extractionErr; // FIX: Stoppe le flux si aucun JSON n'est extrait.
      }
      sections = validateDeepSeekSections_(JSON.parse(jsonString)); // FIX: Applique la validation sur le JSON extrait.
    } catch (e) {
      return {
        success: false,
        error: e.message || "La réponse IA est invalide.", // FIX: Expose un message explicite lorsqu'une section manque ou est trop courte.
        code: e.code || "INVALID_SECTIONS", // FIX: Transmet un code d'erreur exploitable côté interface pour guider l'utilisateur.
        rawContent: llm.content, // FIX: Ajoute le contenu brut pour le débogage côté client.
      }; // FIX: Arrête la génération tant que les sections DeepSeek ne sont pas conformes.
    } // FIX: Fin du bloc de validation JSON retourné par DeepSeek.

    var copy = createTemplateCopy(formData.entrepriseNom);
    if (!copy.success) return copy;

    var updates = Object.assign({}, formData, {
      contexte: sections.contexte || "",
      demarche: sections.demarche || "",
      phases: sections.phases || "",
      phrase: sections.phrase || "",
    });

    var u = applyUpdatesToDoc_(copy.documentId, updates, {
      removeAllHighlight: true,
    });
    if (!u.success) return { success: false, error: u.error, url: copy.url };

    var metadataInfo = appendGenerationMetadata_(copy.documentId, { model: llm.model, promptVersion: PROMPT_VERSION_TAG, generatedAt: new Date() }); // FIX: Ajoute un pied de page indiquant le modèle utilisé et la version du prompt.
    if (!metadataInfo.success) { // FIX: Trace les incidents d'annotation sans bloquer la livraison.
      Logger.log("⚠️ Impossible d'ajouter la note de modèle: %s", metadataInfo.error); // FIX: Informe l'opérateur en cas d'échec d'écriture de la métadonnée.
    } // FIX: Termine la gestion tolérante aux erreurs sur l'ajout de métadonnées.

    var finalization = finalizeProposalDocument_(copy.documentId);
    if (!finalization.success)
      return { success: false, error: finalization.error, url: copy.url };

    var log = logApiUsage_(llm, formData);

    var payload = {
      success: true,
      url: copy.url,
      documentId: copy.documentId,
      model: llm.model,
      usage: llm.usage,
      cost: llm.cost,
      latencyMs: measuredLatency,
      generationDurationMs: measuredLatency,
      aiSections: sections,
      llmContent: llm.content,
      temperature: temp,
      maxTokens: maxTok,
      topP: topP,
      postProcess: finalization.stats,
    };
    payload.promptTokens = promptGuard.tokens; // FIX: Expose l'estimation des tokens côté réponse JSON pour information utilisateur.
    if (metadataInfo && metadataInfo.success && metadataInfo.text) payload.modelMetadata = metadataInfo.text; // FIX: Ajoute la chaîne de métadonnée afin qu'elle soit visible dans l'interface.
    if (log && log.url) payload.costLogUrl = log.url;

    var consoleDoc = createConsoleTranscriptDocument_(llm.content, sections, formData, llm.model);
    if (consoleDoc && consoleDoc.success) {
      payload.consoleDocUrl = consoleDoc.url;
      payload.consoleDocId = consoleDoc.documentId;
    } else if (consoleDoc && consoleDoc.error) {
      payload.consoleDocError = consoleDoc.error;
    }

    var pdfNameParts = [
      "Proposition",
      formData.entrepriseNom || "Client",
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd_HH-mm"
      ),
    ];
    var pdfResult = exportProposalPdf_(copy.documentId, {
      fileName: pdfNameParts.join("_"),
    });
    if (pdfResult.success) {
      payload.pdfFileId = pdfResult.fileId;
      payload.pdfUrl = pdfResult.url;
      payload.pdfFileName = pdfResult.name;
    } else {
      payload.pdfError = pdfResult.error;
      Logger.log("⚠️ Export PDF échoué: %s", pdfResult.error);
    }
    return payload;
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

function generateFromForm(formData) {
  return generateFullProposal(formData);
}

function tokensApprox(chars) {
  return Math.ceil((chars || 0) / 4);
}
function countDocChars_(docId) {
  if (!docId) return 0;
  try {
    return DocumentApp.openById(docId).getBody().getText().length || 0;
  } catch (_) {
    return 0;
  }
}
function estimateApiCost(formData, options) {
  options = options || {};
  var model = resolveDeepseekModel_(options.model);
  var assumeCacheHit = options.assumeCacheHit === true;
  var pagesTarget = Math.max(1, options.pagesTarget || 5);
  var tokensPerPage = Math.max(200, options.tokensPerPage || 600);
  var extraIds =
    options.extraInputDocIds && options.extraInputDocIds.slice
      ? options.extraInputDocIds
      : [];

  var brief = [
    "Entreprise: " +
      (formData && formData.entrepriseNom ? formData.entrepriseNom : ""),
    "Probleme: " +
      (formData && formData.ia_probleme ? formData.ia_probleme : ""),
    "Solution: " +
      (formData && formData.ia_solution ? formData.ia_solution : ""),
    "Objectifs: " +
      (formData && formData.ia_objectifs ? formData.ia_objectifs : ""),
    "Thematique: " +
      (formData && formData.thematique ? formData.thematique : ""),
    "Duree: " + (formData && formData.dureeProjet ? formData.dureeProjet : ""),
    "Adresse: " +
      (formData && formData.entrepriseAdresse
        ? formData.entrepriseAdresse
        : ""),
  ].join("\n");

  var systemPrompt =
    "Tu es un consultant Icam. Retourne STRICTEMENT un JSON {contexte, demarche, phases, phrase}.";
  var userPrompt =
    "A partir du brief ci-dessous, renvoie un JSON {contexte, demarche, phases, phrase}. Brief:\n\n" +
    brief;

  var extraChars = 0;
  for (var i = 0; i < extraIds.length; i++)
    extraChars += countDocChars_(extraIds[i]);

  var inputChars = systemPrompt.length + userPrompt.length + extraChars;
  var inputTokens = tokensApprox(inputChars);
  var outputTokens = pagesTarget * tokensPerPage;

  var pricing =
    DEEPSEEK_PRICING[model] || DEEPSEEK_PRICING[DEFAULT_DEEPSEEK_MODEL];
  var priceIn = assumeCacheHit ? pricing.in_hit : pricing.in_miss;
  var costIn = (inputTokens * priceIn) / ONE_MILLION;
  var costOut = (outputTokens * pricing.out) / ONE_MILLION;
  var total = +(costIn + costOut).toFixed(6);

  return {
    model: model,
    assumeCacheHit: assumeCacheHit,
    input: {
      chars: inputChars,
      tokens: inputTokens,
      price_per_M: priceIn,
      cost: +costIn.toFixed(6),
    },
    output: {
      pages: pagesTarget,
      tokens: outputTokens,
      price_per_M: pricing.out,
      cost: +costOut.toFixed(6),
    },
    total: total,
  };
}

function estimateGenerationDurationMs_(est) {
  var DEFAULT_MS = 15000;
  if (!est) return DEFAULT_MS;
  var tokens = 0;
  if (est.input && typeof est.input.tokens === "number")
    tokens += est.input.tokens;
  if (est.output && typeof est.output.tokens === "number")
    tokens += est.output.tokens;
  var model = est.model || DEFAULT_DEEPSEEK_MODEL;
  var perToken = model === "deepseek-reasoner" ? 18 : 12;
  var base = 5000;
  if (tokens <= 0) return DEFAULT_MS;
  var estimate = base + perToken * tokens;
  if (est.assumeCacheHit) estimate = estimate * 0.85;
  var minMs = 6000;
  var maxMs = 60000;
  if (estimate < minMs) estimate = minMs;
  if (estimate > maxMs) estimate = maxMs;
  return Math.round(estimate);
}

function getOrCreateCostSheet_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(PROP_COST_SHEET_PROPKEY);
  var ss = null;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (_) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create("MSI_Cost_Log");
    try {
      var f = DriveApp.getFileById(ss.getId());
      var dest = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
      dest.addFile(f);
    } catch (_) {}
    props.setProperty(PROP_COST_SHEET_PROPKEY, ss.getId());
  }

  var sh = ss.getSheetByName("log") || ss.getActiveSheet();
  if (!sh) sh = ss.insertSheet("log");

  if (sh.getLastRow() === 0) {
    sh.appendRow(COST_LOG_HEADER);
  } else {
    var headerWidth = COST_LOG_HEADER.length;
    var current = sh
      .getRange(1, 1, 1, Math.max(sh.getLastColumn(), headerWidth))
      .getValues()[0];
    var mismatch = false;
    for (var i = 0; i < headerWidth; i++) {
      if ((current[i] || "") !== COST_LOG_HEADER[i]) {
        mismatch = true;
        break;
      }
    }
    if (mismatch) {
      sh.getRange(1, 1, 1, headerWidth).setValues([COST_LOG_HEADER]);
    }
  }

  return { ss: ss, url: ss.getUrl(), sheet: sh };
}

function logCostEntry_(entry, formData) {
  try {
    var got = getOrCreateCostSheet_();
    var sh =
      got.sheet || got.ss.getSheetByName("log") || got.ss.getActiveSheet();
    var journalTs = "";
    if (formData && formData.journalHorodatage) {
      var parsedTs = new Date(formData.journalHorodatage);
      journalTs = isNaN(parsedTs.getTime())
        ? formData.journalHorodatage
        : parsedTs;
    }
    var journalType = (formData && formData.journalType) || "";
    var journalCours = (formData && formData.journalCours) || "";
    var automationLog = (formData && formData.log) || "";
    function safeNumberField(val, integer) {
      if (typeof val === "number" && !isNaN(val)) return val;
      if (val === null || val === undefined || val === "") return "";
      var parsed = integer
        ? parseInt(val, 10)
        : parseFloat(val);
      return isNaN(parsed) ? "" : parsed;
    }
    var llmTemp = safeNumberField(formData && formData.llmTemperature, false);
    var llmTopP = safeNumberField(formData && formData.llmTopP, false);
    var llmMaxTok = safeNumberField(formData && formData.llmMaxTokens, true);
    sh.appendRow([
      new Date(),
      entry.entryType || "",
      entry.model || "",
      entry.cacheHit === true
        ? "hit"
        : entry.cacheHit === false
        ? "miss"
        : entry.cacheHit || "",
      entry.inputTokens != null ? entry.inputTokens : "",
      entry.inputChars != null ? entry.inputChars : "",
      entry.inputPrice != null ? entry.inputPrice : "",
      entry.inputCost != null ? entry.inputCost : "",
      entry.outputTokens != null ? entry.outputTokens : "",
      entry.outputPages != null ? entry.outputPages : "",
      entry.outputPrice != null ? entry.outputPrice : "",
      entry.outputCost != null ? entry.outputCost : "",
      entry.total != null ? entry.total : "",
      entry.latency != null ? entry.latency : "",
      (formData && formData.entrepriseNom) || "",
      (formData && formData.titre) || "",
      (formData && formData.thematique) || "",
      (formData && formData.dureeProjet) || "",
      journalTs,
      journalType,
      journalCours,
      automationLog,
      llmTemp,
      llmTopP,
      llmMaxTok,
    ]);
    return { success: true, url: got.url };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function logCostEstimation_(est, formData) {
  return logCostEntry_(
    {
      entryType: "estimation",
      model: est.model,
      cacheHit: est.assumeCacheHit,
      inputTokens: est.input.tokens,
      inputChars: est.input.chars,
      inputPrice: est.input.price_per_M,
      inputCost: est.input.cost,
      outputTokens: est.output.tokens,
      outputPages: est.output.pages,
      outputPrice: est.output.price_per_M,
      outputCost: est.output.cost,
      total: est.total,
      latency: "",
    },
    formData
  );
}

function logApiUsage_(callResult, formData) {
  if (!callResult || !callResult.success) return { success: false };
  var pricing =
    DEEPSEEK_PRICING[callResult.model] ||
    DEEPSEEK_PRICING[DEFAULT_DEEPSEEK_MODEL];
  return logCostEntry_(
    {
      entryType: "call",
      model: callResult.model,
      cacheHit: "",
      inputTokens: (callResult.usage && callResult.usage.prompt_tokens) || 0,
      inputChars: "",
      inputPrice: pricing.in_miss,
      inputCost: (callResult.cost && callResult.cost.inputUsd) || 0,
      outputTokens:
        (callResult.usage && callResult.usage.completion_tokens) || 0,
      outputPages: "",
      outputPrice: pricing.out,
      outputCost: (callResult.cost && callResult.cost.outputUsd) || 0,
      total: (callResult.cost && callResult.cost.totalUsd) || 0,
      latency: callResult.latencyMs || "",
    },
    formData
  );
}

function estimateAndLogCost_public(formData) {
  var est = estimateApiCost(formData, {
    model: resolveDeepseekModel_(formData && formData.deepseekModel),
    assumeCacheHit: false,
    pagesTarget: 5,
    tokensPerPage: 600,
  });
  var log = logCostEstimation_(est, formData);
  var etaMs = estimateGenerationDurationMs_(est);
  est.estimatedDurationMs = etaMs;
  return {
    est: est,
    sheetUrl: log && log.url ? log.url : null,
    estimatedDurationMs: etaMs,
  };
}

function getCostLogUrl_public() {
  var got = getOrCreateCostSheet_();
  return got && got.url ? got.url : null;
}

function round4(x) {
  return Math.round((x + Math.sign(x || 0) * Number.EPSILON) * 10000) / 10000;
}