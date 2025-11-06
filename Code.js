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

  var t0 = Date.now();
  var resp;
  try {
    resp = UrlFetchApp.fetch(DEEPSEEK_BASE_URL, fetchOptions);
  } catch (err) {
    return {
      success: false,
      error: "Erreur DeepSeek: " + String(err.message || err),
    };
  }
  var latencyMs = Date.now() - t0;

  var status = resp.getResponseCode();
  var body = resp.getContentText();
  if (status < 200 || status >= 300) {
    return { success: false, error: "DeepSeek HTTP " + status + ": " + body };
  }

  var json;
  try {
    json = JSON.parse(body);
  } catch (err) {
    return {
      success: false,
      error: "Reponse DeepSeek invalide: " + String(err.message || err),
    };
  }

  var content =
    (json.choices &&
      json.choices[0] &&
      json.choices[0].message &&
      json.choices[0].message.content) ||
    "";
  if (!content) {
    return { success: false, error: "Reponse DeepSeek vide." };
  }

  var usage = json.usage || {};
  var cost = calculateUsageCost_(usage, model);

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

const PROP_ICAM_LOGO_CACHE = "ICAM_LOGO_DATAURL";
const ICAM_LOGO_FALLBACK =
  "data:image/png;base64," +
  "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";
function getIcamLogoDataUrl() {
  try {
    var prop = PropertiesService.getScriptProperties();
    var cached = prop.getProperty(PROP_ICAM_LOGO_CACHE);
    if (cached) return cached;

    var url = "https://www.icam.fr/wp-content/uploads/2017/08/logo-icam-2.png";
    try {
      var resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
      });
      if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
        var blob = resp.getBlob();
        var base64 = Utilities.base64Encode(blob.getBytes());
        var mime = blob.getContentType() || "image/png";
        var dataUrl = "data:" + mime + ";base64," + base64;
        prop.setProperty(PROP_ICAM_LOGO_CACHE, dataUrl);
        return dataUrl;
      }
    } catch (_) {}

    prop.setProperty(PROP_ICAM_LOGO_CACHE, ICAM_LOGO_FALLBACK);
    return ICAM_LOGO_FALLBACK;
  } catch (e) {
    return ICAM_LOGO_FALLBACK;
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

  Object.keys(updates || {}).forEach(function (field) {
    var val = updates[field];
    var ph = "[[" + field + "]]";
    var patt = escRegex(ph);
    var isLogo =
      field === "entrepriseLogo" && /^https?:\/\//i.test(String(val || ""));

    containers.forEach(function (el) {
      if (!el) return;
      var r;
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
      }
    });
  });

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

        var val = updates[field];
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
      "Entreprise: " + (formData.entrepriseNom || ""),
      "Probleme: " + (formData.ia_probleme || ""),
      "Solution: " + (formData.ia_solution || ""),
      "Objectifs: " + (formData.ia_objectifs || ""),
      "Thematique: " + (formData.thematique || ""),
      "Duree: " + (formData.dureeProjet || ""),
      "Adresse: " + (formData.entrepriseAdresse || ""),
    ].join("\n");
    var sys =
      "Tu es un consultant Icam. Retourne STRICTEMENT un JSON {contexte, demarche, phases, phrase}.";
    var user =
      "A partir du brief ci-dessous, renvoie un JSON {contexte, demarche, phases, phrase}. Brief:\n\n" +
      brief;

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

    var sections;
    try {
      sections = JSON.parse(llm.content);
    } catch (e) {
      return {
        success: false,
        error: "La reponse IA nest pas un JSON valide: " + e.message,
      };
    }

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
    };
    if (log && log.url) payload.costLogUrl = log.url;
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