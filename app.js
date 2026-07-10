"use strict";

const DATA_INDEX_URL = "experts.json";
const MAX_RESULTS = 12;
const DEFAULT_SHARDS_TO_LOAD = 3;
const MAX_SHARDS_TO_SEARCH = 8;

const TERM_WEIGHTS = {
  field: 3.2,
  keyword: 7.5,
  paper: 2.1
};

const PHRASE_WEIGHTS = {
  field: 10,
  keyword: 18,
  paper: 6
};

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "also", "am", "an",
  "and", "any", "are", "as", "at", "be", "because", "been", "before", "being",
  "between", "both", "but", "by", "can", "could", "did", "do", "does", "doing",
  "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "here", "how", "if", "in", "into", "is", "it", "its", "itself",
  "just", "more", "most", "my", "no", "nor", "not", "of", "off", "on", "once",
  "only", "or", "other", "our", "out", "over", "own", "same", "should", "so",
  "some", "such", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "very", "was", "we", "were", "what", "when", "where", "which", "while",
  "who", "whom", "why", "will", "with", "would", "you", "your"
]);

const SYNONYMS = new Map([
  ["ai", ["artificial", "intelligence", "machine", "learning"]],
  ["ml", ["machine", "learning"]],
  ["nlp", ["natural", "language", "processing"]],
  ["cv", ["computer", "vision"]],
  ["hci", ["human", "computer", "interaction", "user", "experience"]],
  ["ux", ["user", "experience", "human", "computer", "interaction"]],
  ["rl", ["reinforcement", "learning"]],
  ["gcn", ["graph", "neural", "network"]],
  ["gnn", ["graph", "neural", "network"]],
  ["llm", ["large", "language", "model"]],
  ["llms", ["large", "language", "models"]],
  ["pde", ["partial", "differential", "equation"]],
  ["pdes", ["partial", "differential", "equations"]],
  ["gcnc", ["guidance", "navigation", "control"]],
  ["gnc", ["guidance", "navigation", "control"]],
  ["ev", ["electric", "vehicle"]],
  ["evs", ["electric", "vehicles"]],
  ["bci", ["brain", "computer", "interface"]],
  ["eeg", ["electroencephalography", "brain", "signal"]],
  ["mri", ["magnetic", "resonance", "imaging"]],
  ["fmri", ["functional", "magnetic", "resonance", "imaging"]],
  ["gis", ["geographic", "information", "systems", "geospatial"]],
  ["iot", ["internet", "things", "sensor", "network"]],
  ["pv", ["photovoltaic", "solar", "energy"]],
  ["cfd", ["computational", "fluid", "dynamics"]],
  ["fea", ["finite", "element", "analysis"]],
  ["gwas", ["genome", "wide", "association", "study"]],
  ["qtl", ["quantitative", "trait", "locus"]],
  ["dna", ["genetics", "genomics", "sequencing"]],
  ["rna", ["transcriptomics", "gene", "expression"]],
  ["pcr", ["polymerase", "chain", "reaction", "molecular", "biology"]],
  ["rct", ["randomized", "controlled", "trial"]],
  ["cbt", ["cognitive", "behavioral", "therapy"]]
]);

const inputEl = document.querySelector("#student-input");
const wordCountEl = document.querySelector("#word-count");
const fieldFilterEl = document.querySelector("#field-filter");
const findButtonEl = document.querySelector("#find-button");
const resultsEl = document.querySelector("#results");
const resultSummaryEl = document.querySelector("#result-summary");

let datasetMode = "loading";
let manifest = null;
let legacyDataset = null;
let totalExpertCount = 0;
let activeSearchId = 0;

const shardCache = new Map();

document.addEventListener("DOMContentLoaded", init);
inputEl.addEventListener("input", updateWordCount);
fieldFilterEl.addEventListener("change", () => {
  if (inputEl.value.trim()) {
    runSearch();
  }
});
findButtonEl.addEventListener("click", runSearch);

async function init() {
  updateWordCount();
  findButtonEl.disabled = true;
  setSummary("Loading mentor database...");
  renderEmptyState("Preparing mentor search...");

  try {
    const response = await fetch(DATA_INDEX_URL);

    if (!response.ok) {
      throw new Error(`Could not load mentor data (${response.status})`);
    }

    const payload = await response.json();

    if (isShardedManifest(payload)) {
      datasetMode = "sharded";
      manifest = normalizeManifest(payload);
      totalExpertCount = manifest.totalExperts;
      populateFieldFilterFromManifest(manifest);
      findButtonEl.disabled = false;
      setSummary(`Ready to search ${totalExpertCount.toLocaleString()} mentor records.`);
      renderEmptyState("Enter a paragraph, then choose Find Mentors.");
      return;
    }

    if (!Array.isArray(payload)) {
      throw new Error("Mentor data is not in a recognized format.");
    }

    datasetMode = "single";
    totalExpertCount = payload.length;
    setSummary(`Indexing ${payload.length.toLocaleString()} mentor records...`);
    await waitForPaint();
    legacyDataset = {
      experts: payload,
      index: await buildSearchIndex(payload)
    };
    populateFieldFilterFromExperts(payload);
    findButtonEl.disabled = false;
    setSummary(`${payload.length.toLocaleString()} mentor records loaded.`);
    renderEmptyState("Enter a paragraph, then choose Find Mentors.");
  } catch (error) {
    console.error(error);
    datasetMode = "error";
    setSummary("Could not load mentor data.");
    renderEmptyState("Start the local server, then reload this page.");
  }
}

function isShardedManifest(payload) {
  return Boolean(payload && typeof payload === "object" && Array.isArray(payload.shards));
}

function normalizeManifest(payload) {
  const shards = payload.shards
    .filter((shard) => shard && shard.file)
    .map((shard, index) => ({
      ...shard,
      index,
      count: Number(shard.count || 0),
      fields: Array.isArray(shard.fields) ? shard.fields : [],
      field_keys: Array.isArray(shard.field_keys) ? shard.field_keys : [],
      keywords: Array.isArray(shard.keywords) ? shard.keywords : [],
      token_hints: Array.isArray(shard.token_hints) ? shard.token_hints : [],
      phrase_hints: Array.isArray(shard.phrase_hints) ? shard.phrase_hints : []
    }));

  return {
    totalExperts: Number(payload.total_experts || payload.totalExperts || sum(shards.map((shard) => shard.count))),
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    shards
  };
}

async function runSearch() {
  const studentText = inputEl.value.trim();
  const searchId = activeSearchId + 1;
  activeSearchId = searchId;

  if (datasetMode === "loading") {
    setSummary("Mentor index is still loading.");
    return;
  }

  if (datasetMode === "error") {
    setSummary("Mentor data is not available yet.");
    return;
  }

  if (!studentText) {
    setSummary("Enter a project paragraph first.");
    renderEmptyState("Your paragraph can be rough. Specific methods, fields, technologies, and goals help most.");
    return;
  }

  const query = buildQuery(studentText);

  if (query.tokens.length === 0 && query.phrases.length === 0) {
    setSummary("Try adding a few more specific research terms.");
    renderEmptyState("Words like robotics, climate modeling, power electronics, plant genomics, or public health work well.");
    return;
  }

  findButtonEl.disabled = true;
  renderEmptyState("Scoring mentor matches...");

  try {
    const selectedField = fieldFilterEl.value;
    const selectedFieldKey = selectedField === "all" ? "" : selectedField;
    const searchResult = datasetMode === "sharded"
      ? await scoreShardedQuery(query, selectedFieldKey, searchId)
      : {
          results: scoreQueryAgainstDataset(query, selectedFieldKey, legacyDataset),
          scannedExperts: legacyDataset.experts.length,
          failedGroups: 0
        };

    if (searchId !== activeSearchId) {
      return;
    }

    const results = searchResult.results;

    if (results.length === 0) {
      setSummary("No positive matches found.");
      renderEmptyState("Try removing the field filter or adding more technical keywords from your project.");
      return;
    }

    setSummary(formatSearchSummary(results.length, searchResult));
    renderResults(results, studentText);
  } catch (error) {
    console.error(error);
    setSummary("Search could not complete.");
    renderEmptyState("Refresh the page and try the search again.");
  } finally {
    if (searchId === activeSearchId) {
      findButtonEl.disabled = false;
    }
  }
}

async function scoreShardedQuery(query, selectedFieldKey, searchId) {
  const candidates = selectShardCandidates(query, selectedFieldKey);
  const selectedShards = candidates.slice(0, MAX_SHARDS_TO_SEARCH);
  const minimumShardCount = selectedFieldKey
    ? Math.min(selectedShards.length, MAX_SHARDS_TO_SEARCH)
    : Math.min(DEFAULT_SHARDS_TO_LOAD, selectedShards.length);
  let combinedResults = [];
  let searchedGroups = 0;
  let scannedExperts = 0;
  let failedGroups = 0;

  for (let index = 0; index < selectedShards.length; index += 1) {
    const shouldContinue = index < minimumShardCount || combinedResults.length < MAX_RESULTS;
    if (!shouldContinue) {
      break;
    }

    if (searchId !== activeSearchId) {
      return { results: [], searchedGroups, scannedExperts, failedGroups };
    }

    const shard = selectedShards[index].shard;
    setSummary(`Loading relevant mentor records... ${scannedExperts.toLocaleString()} of ${totalExpertCount.toLocaleString()} experts scanned.`);

    let dataset = null;
    try {
      dataset = await loadShardDataset(shard);
    } catch (error) {
      failedGroups += 1;
      console.warn("Skipping a mentor data group that could not load.", error);
      continue;
    }

    searchedGroups += 1;
    scannedExperts += dataset.experts.length;

    if (searchId !== activeSearchId) {
      return { results: [], searchedGroups, scannedExperts, failedGroups };
    }

    setSummary(`Scoring mentor matches... ${scannedExperts.toLocaleString()} of ${totalExpertCount.toLocaleString()} experts scanned.`);
    await waitForPaint();

    try {
      const shardResults = scoreQueryAgainstDataset(query, selectedFieldKey, dataset);
      combinedResults = mergeTopResults(combinedResults, shardResults);
    } catch (error) {
      failedGroups += 1;
      console.warn("Skipping a mentor data group that could not be scored.", error);
    }
  }

  return {
    results: combinedResults.slice(0, MAX_RESULTS),
    searchedGroups,
    scannedExperts,
    failedGroups
  };
}

function formatSearchSummary(resultCount, searchResult) {
  const scannedExperts = Number(searchResult.scannedExperts || 0);
  const totalExperts = Math.max(Number(totalExpertCount || 0), scannedExperts);
  const skippedText = searchResult.failedGroups
    ? " Some records were skipped because they could not be loaded."
    : "";

  return `Showing ${resultCount} top matches after scanning ${scannedExperts.toLocaleString()} of ${totalExperts.toLocaleString()} experts.${skippedText}`;
}

function selectShardCandidates(query, selectedFieldKey) {
  const scored = manifest.shards.map((shard) => ({
    shard,
    score: scoreShardForQuery(shard, query, selectedFieldKey)
  }));
  const fieldMatches = selectedFieldKey
    ? scored.filter((item) => item.score > Number.NEGATIVE_INFINITY)
    : scored;
  const pool = fieldMatches.length > 0 ? fieldMatches : scored;

  return pool.sort((a, b) => b.score - a.score || b.shard.count - a.shard.count || a.shard.index - b.shard.index);
}

function scoreShardForQuery(shard, query, selectedFieldKey) {
  const profile = getShardProfile(shard);
  let score = 0;

  if (selectedFieldKey) {
    if (!profile.fieldKeys.has(selectedFieldKey)) {
      return Number.NEGATIVE_INFINITY;
    }
    score += 120;
  }

  query.tokens.forEach((token) => {
    if (profile.fieldTokens.has(token)) {
      score += 5;
    }
    if (profile.tokenHints.has(token)) {
      score += 2;
    }
  });

  query.phrases.forEach((phrase) => {
    if (profile.phraseHints.has(phrase)) {
      score += 12;
    }
  });

  return score + Math.log1p(shard.count || 1) * 0.02;
}

function getShardProfile(shard) {
  if (shard.profile) {
    return shard.profile;
  }

  const fieldKeys = new Set(shard.field_keys.length > 0 ? shard.field_keys : shard.fields.map(toFieldKey));
  const fieldTokens = new Set();
  const tokenHints = new Set();
  const phraseHints = new Set();

  shard.fields.forEach((field) => {
    const tokens = tokenize(field);
    tokens.forEach((token) => fieldTokens.add(token));
    buildPhraseList(tokens, 2, 5).forEach((phrase) => phraseHints.add(phrase));
  });

  [...shard.keywords, ...shard.token_hints].forEach((value) => {
    tokenize(value).forEach((token) => tokenHints.add(token));
  });

  [...shard.keywords, ...shard.phrase_hints].forEach((value) => {
    const tokens = tokenize(value);
    if (tokens.length >= 2) {
      phraseHints.add(tokens.join(" "));
    }
    buildPhraseList(tokens, 2, 5).forEach((phrase) => phraseHints.add(phrase));
  });

  shard.profile = { fieldKeys, fieldTokens, tokenHints, phraseHints };
  return shard.profile;
}

async function loadShardDataset(shard) {
  if (shardCache.has(shard.file)) {
    return shardCache.get(shard.file);
  }

  const response = await fetch(shard.file);

  if (!response.ok) {
    throw new Error(`Could not load mentor group (${response.status})`);
  }

  const experts = await response.json();
  const dataset = {
    experts,
    index: await buildSearchIndex(experts)
  };
  shardCache.set(shard.file, dataset);
  return dataset;
}

async function buildSearchIndex(expertList) {
  const termIndex = new Map();
  const phraseIndex = new Map();
  const fieldNames = new Map();
  const docLengths = [];
  const fieldKeysByExpert = [];

  for (let expertIndex = 0; expertIndex < expertList.length; expertIndex += 1) {
    const expert = expertList[expertIndex];
    const termWeights = new Map();
    const phraseWeights = new Map();
    const fieldKeys = (expert.fields || []).map(toFieldKey);
    fieldKeysByExpert[expertIndex] = new Set(fieldKeys);

    (expert.fields || []).forEach((field) => {
      fieldNames.set(toFieldKey(field), field);
      addTextToIndex(termWeights, phraseWeights, field, TERM_WEIGHTS.field, PHRASE_WEIGHTS.field);
    });
    (expert.keywords || []).forEach((keyword) => {
      addTextToIndex(termWeights, phraseWeights, keyword, TERM_WEIGHTS.keyword, PHRASE_WEIGHTS.keyword);
    });
    (expert.papers || []).forEach((paper) => {
      addTextToIndex(termWeights, phraseWeights, paper, TERM_WEIGHTS.paper, PHRASE_WEIGHTS.paper);
    });

    let docLength = 0;
    termWeights.forEach((weight, term) => {
      docLength += weight;
      addPosting(termIndex, term, expertIndex, weight);
    });
    phraseWeights.forEach((weight, phrase) => {
      addPosting(phraseIndex, phrase, expertIndex, weight);
    });
    docLengths[expertIndex] = Math.max(1, docLength);

    if (expertIndex > 0 && expertIndex % 1500 === 0) {
      await waitForPaint();
    }
  }

  return {
    termIndex,
    phraseIndex,
    fieldNames,
    fieldKeysByExpert,
    docLengths,
    averageDocLength: average(docLengths),
    totalDocs: expertList.length
  };
}

function addTextToIndex(termWeights, phraseWeights, text, termWeight, phraseWeight) {
  const tokens = tokenize(text);
  const tokenCounts = countTokens(tokens);

  tokenCounts.forEach((count, token) => {
    addWeight(termWeights, token, termWeight * Math.min(count, 3));
  });

  buildPhraseList(tokens, 2, 5).forEach((phrase) => {
    const words = phrase.split(" ");
    if (words.length >= 2) {
      addWeight(phraseWeights, phrase, phraseWeight + words.length);
    }
  });
}

function addPosting(index, key, expertIndex, weight) {
  if (!index.has(key)) {
    index.set(key, []);
  }
  index.get(key).push({ expertIndex, weight });
}

function addWeight(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function scoreQueryAgainstDataset(query, selectedFieldKey, dataset) {
  const scores = new Map();
  const matchedTerms = new Map();
  const index = dataset.index;

  query.tokenCounts.forEach((count, token) => {
    addMatchesFromPostings({
      postings: index.termIndex.get(token) || [],
      label: token,
      queryWeight: Math.min(count, 3),
      selectedFieldKey,
      scores,
      matchedTerms,
      isPhrase: false,
      index
    });
  });

  query.phrases.forEach((phrase) => {
    addMatchesFromPostings({
      postings: index.phraseIndex.get(phrase) || [],
      label: phrase,
      queryWeight: 1.35,
      selectedFieldKey,
      scores,
      matchedTerms,
      isPhrase: true,
      index
    });
  });

  return [...scores.entries()]
    .map(([expertIndex, score]) => ({
      expert: dataset.experts[expertIndex],
      score: Math.round(score * 10) / 10,
      matchedTerms: topMatchedTerms(matchedTerms.get(expertIndex) || new Map())
    }))
    .filter((result) => result.score > 0)
    .sort(compareResults)
    .slice(0, MAX_RESULTS);
}

function addMatchesFromPostings({ postings, label, queryWeight, selectedFieldKey, scores, matchedTerms, isPhrase, index }) {
  if (postings.length === 0) {
    return;
  }

  const idf = inverseDocumentFrequency(postings.length, index);
  const phraseBoost = isPhrase ? 1.4 : 1;

  postings.forEach(({ expertIndex, weight }) => {
    if (selectedFieldKey && !index.fieldKeysByExpert[expertIndex].has(selectedFieldKey)) {
      return;
    }

    const bm25 = bm25Weight(weight, index.docLengths[expertIndex], index);
    const contribution = idf * bm25 * queryWeight * phraseBoost;
    scores.set(expertIndex, (scores.get(expertIndex) || 0) + contribution);

    if (!matchedTerms.has(expertIndex)) {
      matchedTerms.set(expertIndex, new Map());
    }
    const terms = matchedTerms.get(expertIndex);
    terms.set(label, (terms.get(label) || 0) + contribution);
  });
}

function mergeTopResults(existing, incoming) {
  const bestById = new Map();

  [...existing, ...incoming].forEach((result) => {
    const key = result.expert.id || `${result.expert.name}::${result.expert.affiliation}`;
    const previous = bestById.get(key);
    if (!previous || compareResults(result, previous) < 0) {
      bestById.set(key, result);
    }
  });

  return [...bestById.values()].sort(compareResults).slice(0, MAX_RESULTS);
}

function compareResults(a, b) {
  return b.score - a.score || a.expert.name.localeCompare(b.expert.name);
}

function inverseDocumentFrequency(documentFrequency, index) {
  const numerator = index.totalDocs - documentFrequency + 0.5;
  const denominator = documentFrequency + 0.5;
  return Math.max(0.25, Math.log(1 + numerator / denominator));
}

function bm25Weight(weight, docLength, index) {
  const k1 = 1.4;
  const b = 0.72;
  const lengthNorm = 1 - b + b * (docLength / index.averageDocLength);
  return (weight * (k1 + 1)) / (weight + k1 * lengthNorm);
}

function topMatchedTerms(termScores) {
  return [...termScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([term]) => term);
}

function buildQuery(text) {
  const baseTokens = tokenize(text);
  const expandedTokens = expandTokens(baseTokens);
  const tokenCounts = countTokens(expandedTokens);
  const phrases = [...new Set([
    ...buildPhraseList(baseTokens, 2, 5),
    ...buildPhraseList(expandedTokens, 2, 5)
  ])];

  return {
    tokens: [...new Set(expandedTokens)],
    tokenCounts,
    phrases
  };
}

function expandTokens(tokens) {
  const expanded = [...tokens];

  tokens.forEach((token) => {
    const additions = SYNONYMS.get(token);
    if (additions) {
      additions.forEach((item) => expanded.push(stemToken(item)));
    }
  });

  const joined = tokens.join(" ");
  if (joined.includes("human computer")) {
    expanded.push("hci", "user", "experience");
  }
  if (joined.includes("artificial intelligence")) {
    expanded.push("ai", "machine", "learning");
  }
  if (joined.includes("plant breeding")) {
    expanded.push("crop", "genomics", "phenotyping");
  }
  if (joined.includes("criminal justice")) {
    expanded.push("criminology", "policing", "law");
  }

  return expanded.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function tokenize(text) {
  const matches = normalizePlainText(text).match(/[a-z0-9]+/g) || [];

  return matches
    .map(stemToken)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function normalizePlainText(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token) {
  let word = token.toLowerCase();

  const suffixRules = [
    ["ization", "ize"],
    ["ational", "ate"],
    ["fulness", "ful"],
    ["iveness", "ive"],
    ["encies", "ency"],
    ["ances", "ance"],
    ["ingly", ""],
    ["edly", ""],
    ["ments", "ment"],
    ["ities", "ity"],
    ["ies", "y"],
    ["ing", ""],
    ["ers", "er"],
    ["ed", ""],
    ["es", ""],
    ["s", ""]
  ];

  for (const [suffix, replacement] of suffixRules) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length) + replacement;
    }
  }

  return word;
}

function buildPhraseList(tokens, minSize, maxSize) {
  const phrases = new Set();

  for (let size = minSize; size <= maxSize; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      phrases.add(tokens.slice(index, index + size).join(" "));
    }
  }

  return [...phrases];
}

function countTokens(tokens) {
  const counts = new Map();

  tokens.forEach((token) => {
    counts.set(token, (counts.get(token) || 0) + 1);
  });

  return counts;
}

function populateFieldFilterFromManifest(currentManifest) {
  const fieldNames = new Map();

  currentManifest.fields.forEach((field) => {
    if (typeof field === "string") {
      fieldNames.set(toFieldKey(field), field);
    } else if (field && field.key && field.label) {
      fieldNames.set(field.key, field.label);
    }
  });

  currentManifest.shards.forEach((shard) => {
    shard.fields.forEach((field) => {
      fieldNames.set(toFieldKey(field), field);
    });
  });

  populateFieldFilter(fieldNames);
}

function populateFieldFilterFromExperts(expertList) {
  const fieldNames = new Map();

  expertList.forEach((expert) => {
    (expert.fields || []).forEach((field) => {
      fieldNames.set(toFieldKey(field), field);
    });
  });

  populateFieldFilter(fieldNames);
}

function populateFieldFilter(fieldNames) {
  fieldFilterEl.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All fields";
  fieldFilterEl.append(allOption);

  [...fieldNames.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([key, label]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = titleCase(label);
      fieldFilterEl.append(option);
    });
}

function updateWordCount() {
  const words = inputEl.value.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  const count = inputEl.value.trim() ? words.length : 0;
  wordCountEl.textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function renderResults(results, studentText) {
  resultsEl.replaceChildren();

  const fragment = document.createDocumentFragment();
  results.forEach((result, index) => {
    fragment.append(createMentorCard(result, index + 1, studentText));
  });

  resultsEl.append(fragment);
}

function createMentorCard(result, rank, studentText) {
  const { expert, score, matchedTerms } = result;
  const card = el("article", "mentor-card");
  card.setAttribute("aria-label", `${expert.name}, match score ${score}`);

  const top = el("div", "card-top");
  const identity = el("div");
  identity.append(el("h3", "", `${rank}. ${expert.name}`));
  identity.append(el("p", "card-meta", expert.affiliation));

  const scoreBadge = el("div", "score-badge", score.toFixed(1));
  scoreBadge.append(el("span", "", "score"));
  top.append(identity, scoreBadge);

  const contact = el("div", "contact-row");
  if (expert.email) {
    const email = el("a", "", expert.email);
    email.href = `mailto:${expert.email}`;
    contact.append(email);
  }
  if (expert.website) {
    const website = el("a", "", "Profile");
    website.href = expert.website;
    website.target = "_blank";
    website.rel = "noreferrer";
    contact.append(website);
  }

  card.append(top, contact);
  if (matchedTerms.length > 0) {
    card.append(el("p", "matched-terms", `Matched terms: ${matchedTerms.join(", ")}`));
  }
  card.append(createListSection("Fields", expert.fields || [], "tag-list"));
  card.append(createListSection("Keywords", expert.keywords || [], "tag-list"));
  card.append(createListSection("Relevant papers", expert.papers || [], "paper-list"));

  const actions = el("div", "score-row");
  actions.append(el("span", "card-meta", `Match score: ${score.toFixed(1)}`));

  const copyButton = el("button", "copy-button", "Copy outreach email draft");
  copyButton.type = "button";
  copyButton.addEventListener("click", () => copyOutreachDraft(copyButton, expert, studentText));
  actions.append(copyButton);

  card.append(actions);

  return card;
}

function createListSection(label, items, listClass) {
  const section = el("section");
  section.append(el("p", "section-label", label));

  const list = el("ul", listClass);
  items.forEach((item) => list.append(el("li", "", item)));
  section.append(list);

  return section;
}

async function copyOutreachDraft(button, expert, studentText) {
  const draft = normalizeClipboardText(buildOutreachDraft(expert, studentText));
  const copied = await copyPlainText(draft);

  if (copied) {
    showCopiedState(button, "Copied");
    return;
  }

  showManualCopyDialog(draft);
  showCopiedState(button, "Draft opened");
}

function buildOutreachDraft(expert, studentText) {
  const lastName = expert.name.split(" ").slice(-1)[0];
  const keywordList = (expert.keywords || []).slice(0, 3).join(", ");
  const paper = (expert.papers || [])[0] || "";
  const researchLine = keywordList
    ? `Your work on ${keywordList} stood out to me${paper ? `, especially "${paper}."` : "."}`
    : `Your research profile stood out to me${paper ? `, especially "${paper}."` : "."}`;

  return `Subject: Student interested in your research

Dear Dr. ${lastName},

My name is [Your Name], and I am exploring potential mentors for a student research project. My current idea is:

"${studentText}"

${researchLine} If you are open to it, I would be grateful for a short conversation or any advice about whether my interests connect with your research.

Thank you for your time,
[Your Name]`;
}

async function copyPlainText(text) {
  const plainText = normalizeClipboardText(text);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(plainText);
      return true;
    } catch (error) {
      console.debug("Clipboard writeText failed; trying legacy copy.", error);
    }
  }

  if (isIOSDevice()) {
    return false;
  }

  return fallbackCopyText(plainText);
}

function fallbackCopyText(text) {
  const hiddenTextarea = document.createElement("textarea");
  hiddenTextarea.value = text;
  hiddenTextarea.setAttribute("readonly", "");
  hiddenTextarea.style.position = "fixed";
  hiddenTextarea.style.top = "0";
  hiddenTextarea.style.left = "0";
  hiddenTextarea.style.width = "1px";
  hiddenTextarea.style.height = "1px";
  hiddenTextarea.style.opacity = "0";
  document.body.append(hiddenTextarea);
  hiddenTextarea.focus();
  hiddenTextarea.select();
  hiddenTextarea.setSelectionRange(0, hiddenTextarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }

  hiddenTextarea.remove();
  return copied;
}

function normalizeClipboardText(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");
}

function isIOSDevice() {
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  return /iPad|iPhone|iPod/.test(userAgent)
    || (platform === "MacIntel" && maxTouchPoints > 1);
}

function showManualCopyDialog(text) {
  const dialog = getCopyDialog();
  const textarea = dialog.querySelector("textarea");
  textarea.value = text;
  dialog.classList.remove("hidden");
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
}

function getCopyDialog() {
  let dialog = document.querySelector("#copy-dialog");
  if (dialog) {
    return dialog;
  }

  dialog = el("div", "copy-dialog hidden");
  dialog.id = "copy-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "copy-dialog-title");

  const panel = el("div", "copy-dialog-panel");
  panel.append(el("h2", "", "Copy email draft"));
  panel.querySelector("h2").id = "copy-dialog-title";
  panel.append(el("p", "card-meta", "Select the text below, then copy it from your device menu."));

  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.rows = 12;
  textarea.autocomplete = "off";
  textarea.autocapitalize = "sentences";
  textarea.spellcheck = false;
  panel.append(textarea);

  const actions = el("div", "dialog-actions");
  const selectButton = el("button", "copy-button", "Select text");
  selectButton.type = "button";
  selectButton.addEventListener("click", () => {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
  });

  const closeButton = el("button", "secondary-button", "Close");
  closeButton.type = "button";
  closeButton.addEventListener("click", () => dialog.classList.add("hidden"));
  actions.append(selectButton, closeButton);
  panel.append(actions);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.classList.add("hidden");
    }
  });

  dialog.append(panel);
  document.body.append(dialog);
  return dialog;
}

function showCopiedState(button, message) {
  const originalText = button.textContent;
  button.textContent = message;
  button.classList.add("copied");

  window.setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("copied");
  }, 1700);
}

function renderEmptyState(message) {
  resultsEl.replaceChildren(el("div", "empty-state", message));
}

function setSummary(message) {
  resultSummaryEl.textContent = message;
}

function toFieldKey(field) {
  return normalizePlainText(field).replace(/\s+/g, "-");
}

function titleCase(text) {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function average(values) {
  if (values.length === 0) {
    return 1;
  }
  return sum(values) / values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function waitForPaint() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function el(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}
