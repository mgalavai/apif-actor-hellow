PRD — Job Pulse (v1)
Goal

Build a single Apify actor called Job Pulse that returns a clean, deduplicated list of fresh job postings with direct application links, sourced from company hiring pages (not job boards).

The actor should be usable today by power users and automations.

Non-Goals (explicitly out of scope)

No UI

No job board scraping (LinkedIn, Indeed, etc.)

No authentication handling

No alerts, webhooks, or scheduling

No advanced scoring or ML

No guarantee of completeness

Inputs (keep minimal)
Required

query: string
Example: "frontend engineer"

Optional (with defaults)

location: string (default: "Remote")

postedWithinDays: number (default: 7)

maxResultsPerSource: number (default: 20)

forceFresh: boolean (default: false)

country: string (default: "US")

language: string (default: "en")

Advanced inputs (optional, hidden by default):

sources: string[]
Default internally to common hiring platforms.

Output
Format

Apify Dataset

One item per job posting

Output item schema
{
  "title": string,
  "company": string,
  "location": string,
  "applyUrl": string,
  "platform": string | null,
  "jobId": string | null,
  "postedAt": string | null,
  "foundAt": string,
  "searchQuery": string
}


Notes:

applyUrl must point directly to the company’s application page.

postedAt may be null if not detectable.

foundAt is always set to current timestamp.

Core Flow (must implement)

Build search queries

Combine:

query

location

platform keywords (internal list)

recency filter derived from postedWithinDays

Result: multiple search queries.

Fetch search results

Call one existing Apify SERP actor (do not implement Google scraping yourself).

Limit results per source using maxResultsPerSource.

Filter results

Keep only URLs matching known company hiring page patterns.

Discard obvious job boards and aggregators.

Canonicalize URLs

Remove tracking parameters.

Normalize URLs per platform when possible.

Deduplicate

Primary key: (platform + jobId) if available.

Fallback: canonical applyUrl.

(Optional but recommended)
Fetch job page HTML (HTTP first, no browser unless required) to extract:

title

company

posted date (best effort)

Store results

Push clean job objects to Dataset.

Caching (minimal, required)

Use Apify Key-Value Store.

Cache targets

Search results per (query + location + postedWithinDays + country + language)

Job page fetches per canonical URL

TTL rules

Search results: 1–3 hours

Job pages: 24–72 hours

If forceFresh === true, bypass cache.

Error handling

If a search query fails, continue with others.

Never fail the entire run due to one source.

Do not cache empty or obviously blocked responses.

Constraints

Default run must finish in a few minutes.

Do not exceed reasonable parallelism.

Keep implementation simple and readable.

Success criteria (v1)

Actor runs with only one required input (query).

Returns a non-empty dataset for common roles.

Outputs direct application links.

Results are deduplicated.

No Google scraping logic written manually.

Naming

Actor name: Job Pulse

Description:
“Find fresh jobs and apply directly on company websites — no job boards.”

Tech notes (guidance, not strict)

Prefer composition over custom scraping.

One main entry file.

Keep platform logic minimal and extensible.

Out of scope (future versions)

Alerts / delta mode

Keyword scoring

User accounts

UI

Guaranteeing job freshness