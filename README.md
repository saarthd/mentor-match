# Mentor Match

Mentor Match is a GitHub Pages-ready static website for matching a student project description to potential research mentors. The site loads a compact dataset index, fetches the most relevant local data shards, scores matches in the browser, and shows the top 12 mentor cards.

The published site does not call OpenAlex, ORCID, OpenAI, Supabase, Semantic Scholar, or any external API. API access is used only by the optional offline generator in `tools/`.

## Project Structure

```text
mentor-match/
  index.html
  styles.css
  app.js
  experts.json
  experts-shard-001.json
  experts-shard-002.json
  ...
  README.md

tools/
  build_experts.py
  validate_experts.py
```

`experts.json` is the small dataset index. The large expert records live in the `experts-shard-*.json` files.

## Run Locally

```bash
cd mentor-match
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Use the local server instead of opening `index.html` directly, because browsers usually block JavaScript from loading local data files from a plain file path.

## Deploy to GitHub Pages

1. Create a GitHub repository.
2. Add the files in this project.
3. Push to the `main` branch.
4. Open the repository settings on GitHub.
5. Go to **Pages**.
6. Choose **Deploy from a branch**.
7. Select the branch and folder that contains `index.html`.
8. Save.

The app uses only relative file paths, so it works whether it is published at the repository root or inside a `/mentor-match/` path.

## Dataset

The current dataset contains 100,000 real public expert records collected from OpenAlex and ORCID metadata. It is split into 7 shard files, each under 25 MB.

Each expert record follows this schema:

```json
{
  "id": "unique-stable-id",
  "name": "Dr. Full Name",
  "affiliation": "University or Institution",
  "email": "public email if available, otherwise empty string",
  "website": "profile, OpenAlex, ORCID, lab, or institution URL",
  "source_url": "source URL used for verification",
  "fields": ["field 1", "field 2"],
  "keywords": ["specific keyword 1", "specific keyword 2"],
  "papers": [
    "Relevant paper title 1",
    "Relevant paper title 2"
  ]
}
```

Do not add private or guessed emails. Leave `email` blank unless it is explicitly public in the source metadata or on a public profile page.

## Regenerate Experts

From the repository root on macOS/Linux:

```bash
export OPENALEX_API_KEY="your_key_here"
python tools/build_experts.py --target 100000 --manifest mentor-match/experts.json --shard-dir mentor-match --shard-prefix experts-shard --max-shard-mb 12 --pages-per-query 4
python tools/validate_experts.py mentor-match/experts.json --min-count 100000 --max-shard-mb 25
unset OPENALEX_API_KEY
```

PowerShell:

```powershell
$env:OPENALEX_API_KEY = "your_key_here"
python tools\build_experts.py --target 100000 --manifest mentor-match\experts.json --shard-dir mentor-match --shard-prefix experts-shard --max-shard-mb 12 --pages-per-query 4
python tools\validate_experts.py mentor-match\experts.json --min-count 100000 --max-shard-mb 25
Remove-Item Env:\OPENALEX_API_KEY
```

Never save the API key in `app.js`, `README.md`, `experts.json`, a shard file, `.env`, or any committed file.

The builder:

- uses OpenAlex and ORCID public metadata
- reads the OpenAlex key from `OPENALEX_API_KEY`
- writes a small `experts.json` index plus `experts-shard-*.json` files
- caches API responses in `tools/.cache/` so interrupted runs can resume without refetching completed pages
- uses retry/backoff behavior for rate limits
- deduplicates records and creates stable IDs from name plus affiliation
- keeps each shard below the configured size limit

## Validate Experts

Run:

```bash
python tools/validate_experts.py mentor-match/experts.json --min-count 100000 --max-shard-mb 25
```

The validator checks:

- valid JSON for the index and all shards
- expert count
- duplicate IDs
- duplicate name and affiliation pairs
- missing required fields
- array types for `fields`, `keywords`, and `papers`
- blank names and affiliations
- shard sizes
- field distribution
- email, website, and source URL counts

## Matching

The browser search:

- tokenizes the student paragraph
- removes stopwords
- normalizes common word endings
- expands common acronyms and synonyms
- detects multi-word phrases
- uses the dataset index to choose relevant expert shards
- boosts keyword, field, and paper-title matches
- uses rare-term weighting with BM25-style scoring
- shows the top 12 matches
- displays matched terms on each mentor card
- copies outreach email drafts as plain text, with a mobile-friendly manual copy fallback
