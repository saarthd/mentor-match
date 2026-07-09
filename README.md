# Mentor Match

Mentor Match is a GitHub Pages-ready static website for matching student project descriptions to potential research mentors. The browser loads `experts.json`, builds a local search index, and returns the top matching experts.

The live site does not call OpenAlex, ORCID, OpenAI, Supabase, or any external API. Dataset generation happens offline with scripts in `tools/`.

## Project Structure

```text
mentor-match/
  index.html
  styles.css
  app.js
  experts.json
  experts.generated.json
  README.md

tools/
  build_experts.py
  validate_experts.py
```

## Run Locally

```bash
cd mentor-match
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Use the local server instead of opening `index.html` directly, because browsers can block JavaScript from loading local JSON files from a plain file path.

## Deploy to GitHub Pages

1. Create a GitHub repository.
2. Add the project files.
3. Push to the `main` branch.
4. Open the repository settings on GitHub.
5. Go to **Pages**.
6. Choose **Deploy from a branch**.
7. Select the `main` branch and root folder.
8. Save.

The published site will work as a static site because all matching happens in the browser.

## Dataset

`experts.json` contains real public research metadata collected from OpenAlex and ORCID. Each expert follows this schema:

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
    "Relevant paper title 2",
    "Relevant paper title 3"
  ]
}
```

Do not add private or guessed emails. Leave `email` blank unless it is explicitly public on the source.

## Regenerate Experts

From the repository root on macOS/Linux:

```bash
export OPENALEX_API_KEY="your_key_here"
python tools/build_experts.py --target 10000 --output mentor-match/experts.generated.json
python tools/validate_experts.py mentor-match/experts.generated.json --min-count 10000
cp mentor-match/experts.generated.json mentor-match/experts.json
unset OPENALEX_API_KEY
```

PowerShell users can set the key for one session like this:

```powershell
$env:OPENALEX_API_KEY = "your_key_here"
python tools\build_experts.py --target 10000 --output mentor-match\experts.generated.json
python tools\validate_experts.py mentor-match\experts.generated.json --min-count 10000
Copy-Item mentor-match\experts.generated.json mentor-match\experts.json -Force
Remove-Item Env:\OPENALEX_API_KEY
```

Never save the API key in `app.js`, `README.md`, `experts.json`, `.env`, or any committed file.

The builder:

- uses OpenAlex and ORCID public metadata
- reads the OpenAlex key from `OPENALEX_API_KEY`
- saves generated output to `experts.generated.json`
- caches API responses in `tools/.cache/` so interrupted runs can resume without refetching completed pages
- uses polite retry/backoff behavior for rate limits
- deduplicates records and creates stable IDs from name plus affiliation

## Validate Experts

Run:

```bash
python tools/validate_experts.py mentor-match/experts.json --min-count 10000
```

The validator checks:

- valid JSON
- expert count
- duplicate IDs
- duplicate name and affiliation pairs
- missing required fields
- array types for `fields`, `keywords`, and `papers`
- blank names and affiliations
- file size
- field distribution
- email, website, and source URL counts

## Matching

The browser search index:

- tokenizes the student paragraph
- removes stopwords
- normalizes common word endings
- expands common STEM acronyms and synonyms
- detects multi-word phrases
- boosts keyword, field, and paper-title matches
- uses rare-term weighting with BM25-style scoring
- shows the top 10 matches
- displays matched terms on each mentor card

No backend or API key is needed to search the published site.
