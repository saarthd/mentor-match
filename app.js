"use strict";

const MAX_RESULTS = 10;
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
  ["fea", ["finite", "element", "analysis"]]
]);

const inputEl = document.querySelector("#student-input");
const wordCountEl = document.querySelector("#word-count");
const fieldFilterEl = document.querySelector("#field-filter");
const findButtonEl = document.querySelector("#find-button");
const resultsEl = document.querySelector("#results");
const resultSummaryEl = document.querySelector("#result-summary");

let experts = [];
let searchIndex = null;

document.addEventListener("DOMContentLoaded", init);
inputEl.addEventListener("input", updateWordCount);
fieldFilterEl.addEventListener("change", runSearch);
findButtonEl.addEventListener("click", runSearch);

async function init() {
  updateWordCount();
  findButtonEl.disabled = true;
  setSummary("Loading mentor database...");
  renderEmptyState("Preparing mentor search...");

  try {
    const response = await fetch("experts.json");

    if (!response.ok) {
      throw new Error(`Could not load experts.json (${response.status})`);
    }

    experts = await response.json();
    setSummary(`Indexing ${experts.length.toLocaleString()} mentor records...`);
    await waitForPaint();

    searchIndex = buildSearchIndex(experts);
    populateFieldFilter(experts);

    findButtonEl.disabled = false;
    setSummary(`${experts.length.toLocaleString()} mentor records loaded.`);
    renderEmptyState("Enter a paragraph, then choose Find Mentors.");
  } catch (error) {
    console.error(error);
    setSummary("Could not load mentor data.");
    renderEmptyState("Start a local server with python -m http.server 8080, then reload this page.");
  }
}

function buildSearchIndex(expertList) {
  const termIndex = new Map();
  const phraseIndex = new Map();
  const fieldNames = new Map();
  const docLengths = [];
  const fieldKeysByExpert = [];

  expertList.forEach((expert, expertIndex) => {
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
  });

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

function runSearch() {
  const studentText = inputEl.value.trim();

  if (!searchIndex) {
    setSummary("Mentor index is still loading.");
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
    renderEmptyState("Words like robotics, climate modeling, power electronics, or public health work well.");
    return;
  }

  findButtonEl.disabled = true;
  setSummary("Scoring mentor matches...");

  window.setTimeout(() => {
    const selectedField = fieldFilterEl.value;
    const results = scoreQuery(query, selectedField);

    findButtonEl.disabled = false;

    if (results.length === 0) {
      setSummary("No positive matches found.");
      renderEmptyState("Try removing the field filter or adding more technical keywords from your project.");
      return;
    }

    setSummary(`Showing ${results.length} of ${experts.length.toLocaleString()} records by match score.`);
    renderResults(results, studentText);
  }, 0);
}

function scoreQuery(query, selectedField) {
  const scores = new Map();
  const matchedTerms = new Map();
  const selectedFieldKey = selectedField === "all" ? "" : selectedField;

  query.tokenCounts.forEach((count, token) => {
    addMatchesFromPostings({
      postings: searchIndex.termIndex.get(token) || [],
      label: token,
      queryWeight: Math.min(count, 3),
      selectedFieldKey,
      scores,
      matchedTerms,
      isPhrase: false
    });
  });

  query.phrases.forEach((phrase) => {
    addMatchesFromPostings({
      postings: searchIndex.phraseIndex.get(phrase) || [],
      label: phrase,
      queryWeight: 1.35,
      selectedFieldKey,
      scores,
      matchedTerms,
      isPhrase: true
    });
  });

  return [...scores.entries()]
    .map(([expertIndex, score]) => ({
      expert: experts[expertIndex],
      score: Math.round(score * 10) / 10,
      matchedTerms: topMatchedTerms(matchedTerms.get(expertIndex) || new Map())
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.expert.name.localeCompare(b.expert.name))
    .slice(0, MAX_RESULTS);
}

function addMatchesFromPostings({ postings, label, queryWeight, selectedFieldKey, scores, matchedTerms, isPhrase }) {
  if (postings.length === 0) {
    return;
  }

  const idf = inverseDocumentFrequency(postings.length);
  const phraseBoost = isPhrase ? 1.4 : 1;

  postings.forEach(({ expertIndex, weight }) => {
    if (selectedFieldKey && !searchIndex.fieldKeysByExpert[expertIndex].has(selectedFieldKey)) {
      return;
    }

    const bm25 = bm25Weight(weight, searchIndex.docLengths[expertIndex]);
    const contribution = idf * bm25 * queryWeight * phraseBoost;
    scores.set(expertIndex, (scores.get(expertIndex) || 0) + contribution);

    if (!matchedTerms.has(expertIndex)) {
      matchedTerms.set(expertIndex, new Map());
    }
    const terms = matchedTerms.get(expertIndex);
    terms.set(label, (terms.get(label) || 0) + contribution);
  });
}

function inverseDocumentFrequency(documentFrequency) {
  const numerator = searchIndex.totalDocs - documentFrequency + 0.5;
  const denominator = documentFrequency + 0.5;
  return Math.max(0.25, Math.log(1 + numerator / denominator));
}

function bm25Weight(weight, docLength) {
  const k1 = 1.4;
  const b = 0.72;
  const lengthNorm = 1 - b + b * (docLength / searchIndex.averageDocLength);
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
  const phrases = buildPhraseList(expandedTokens, 2, 5);

  return {
    tokens: expandedTokens,
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

function populateFieldFilter(expertList) {
  const fieldNames = new Map();

  expertList.forEach((expert) => {
    (expert.fields || []).forEach((field) => {
      fieldNames.set(toFieldKey(field), field);
    });
  });

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
  const draft = buildOutreachDraft(expert, studentText);

  try {
    await navigator.clipboard.writeText(draft);
    showCopiedState(button);
  } catch (error) {
    fallbackCopyText(draft);
    showCopiedState(button);
  }
}

function buildOutreachDraft(expert, studentText) {
  const lastName = expert.name.split(" ").slice(-1)[0];
  const keywordList = (expert.keywords || []).slice(0, 3).join(", ");
  const paper = (expert.papers || [])[0] || "your recent work";

  return `Subject: Student interested in your research

Dear Dr. ${lastName},

My name is [Your Name], and I am exploring potential mentors for a student research project. My current idea is:

"${studentText}"

Your work on ${keywordList} stood out to me, especially "${paper}." If you are open to it, I would be grateful for a short conversation or any advice about whether my interests connect with your research.

Thank you for your time,
[Your Name]`;
}

function fallbackCopyText(text) {
  const hiddenTextarea = document.createElement("textarea");
  hiddenTextarea.value = text;
  hiddenTextarea.setAttribute("readonly", "");
  hiddenTextarea.style.position = "fixed";
  hiddenTextarea.style.left = "-9999px";
  document.body.append(hiddenTextarea);
  hiddenTextarea.select();
  document.execCommand("copy");
  hiddenTextarea.remove();
}

function showCopiedState(button) {
  const originalText = button.textContent;
  button.textContent = "Copied";
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
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
