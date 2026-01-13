# Job Pulse

Find fresh jobs and apply directly on company websites — no job boards.

Job Pulse is an Apify actor designed to help job seekers find the latest job postings on major Applicant Tracking Systems (ATS) like Greenhouse, Lever, Ashby, and more. By using "Google Dorking" techniques, it bypasses job boards and aggregators, giving you direct access to company hiring pages.

## Features

- **Direct Links**: Get links to company application pages, not 3rd party job boards.
- **Freshness**: Highly filtered searches targeting the most recent postings.
- **Consolidated Results**: Scrapes across 40+ hiring platforms in one run.
- **Smart Caching**: Minimizes credit usage by caching search results.
- **Deduplication**: Automatically removes duplicate job postings.

## Input

- **Search Query**: (Required) The job title or keywords (e.g., `"Frontend Engineer"`).
- **Location**: (Default: `"Remote"`) The location where you are seeking roles.
- **Posted Within Days**: (Default: `7`) Filter for jobs posted in the last X days.
- **Max Results Per Source**: (Default: `20`) Limit results from each platform.
- **Force Fresh**: (Default: `false`) Bypass the cache to get live results.
- **Country**: (Default: `"US"`) The target country for searches.

## Output

The actor pushes results to the Apify dataset in the following schema:

```json
{
  "title": "Senior Frontend Engineer",
  "company": "Acme Corp",
  "location": "Remote",
  "applyUrl": "https://boards.greenhouse.io/acme/jobs/12345",
  "platform": "greenhouse.io",
  "jobId": "12345",
  "foundAt": "2026-01-13T10:00:00.000Z",
  "searchQuery": "site:greenhouse.io \"Frontend Engineer\" \"Remote\""
}
```

## How it works

1.  **Dorking**: The actor constructs specialized Google search queries for 40+ ATS platforms.
2.  **Aggregation**: It calls the `apify/google-search-scraper` actor to collect search results.
3.  **Refinement**: It normalizes URLs, extracts company names, and removes duplicates.
4.  **Delivery**: Results are pushed to your Apify dataset, ready for CSV/JSON download.
