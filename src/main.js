import { Actor } from 'apify';
import crypto from 'crypto';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
  query,
  location = 'Remote',
  postedWithinDays = 7,
  maxResultsPerSource = 20,
  forceFresh = false,
  country = 'US',
} = input;

// --- Cost Stoppers (Budget Safety) ---
const ACTOR_START_COST = 0.00005;
const COST_PER_RESULT = 0.00001;

const maxTotalChargeUsd = process.env.APIFY_MAX_TOTAL_CHARGE_USD
  ? Number(process.env.APIFY_MAX_TOTAL_CHARGE_USD)
  : null;

let estimatedCost = ACTOR_START_COST;
let resultsEmitted = 0;

function canEmitAnotherResult() {
  if (!maxTotalChargeUsd) return true;
  const nextCost = estimatedCost + COST_PER_RESULT;
  return nextCost <= maxTotalChargeUsd;
}
// -------------------------------------

if (!query) {
  await Actor.fail('Input "query" is required');
}

const PLATFORMS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'breezy.hr',
];

/**
 * Normalizes a URL by removing query parameters and hash.
 */
const normalizeUrl = (url) => {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (e) {
    return url;
  }
};

/**
 * Generates a cache key based on search parameters.
 */
const generateCacheKey = (params) => {
  const str = JSON.stringify(params);
  return crypto.createHash('md5').update(str).digest('hex');
};

const cache = await Actor.openKeyValueStore();
const cacheParams = { query, location, postedWithinDays, country };
const cacheKey = `cache_${generateCacheKey(cacheParams)}`;

if (!forceFresh) {
  const cachedData = await cache.getValue(cacheKey);
  if (cachedData && (Date.now() - cachedData.timestamp < 3 * 3600 * 1000)) { // 3 hour cache
    console.log('Using cached results from Key-Value Store.');
    await Actor.pushData(cachedData.results);
    await Actor.exit();
    process.exit(0);
  }
}

const finalResults = [];
const seenUrls = new Set();
let limitReached = false;

for (const platform of PLATFORMS) {
  if (limitReached) break;
  console.log(`Searching jobs on ${platform}...`);

  const searchTemplate = `site:${platform} "${query}" "${location}"`;

  try {
    const run = await Actor.call('apify/google-search-scraper', {
      queries: searchTemplate,
      maxPagesPerQuery: 1,
      resultsPerPage: maxResultsPerSource,
      mobileResults: false,
      type: 'SEARCH',
    });

    if (run.status !== 'SUCCEEDED') {
      console.warn(`Search for ${platform} did not succeed. Status: ${run.status}`);
      continue;
    }

    const dataset = await Actor.openDataset(run.defaultDatasetId);
    const { items } = await dataset.getData();

    for (const item of items) {
      if (!item.url) continue;

      const url = normalizeUrl(item.url);

      // Validation: Ensure the URL is actually on the target platform and not a Google link
      if (url.includes('google.com') || !url.includes(platform)) {
        continue;
      }

      if (seenUrls.has(url)) continue;

      if (!canEmitAnotherResult()) {
        console.log('Cost limit reached ($' + maxTotalChargeUsd + '). Stopping early.');
        limitReached = true;
        break;
      }

      // Extract company from URL
      let company = 'Unknown';
      try {
        const parsedUrl = new URL(url);
        const hostParts = parsedUrl.hostname.split('.');

        // Custom logic for different platforms
        if (platform === 'greenhouse.io') {
          // greenhouse usually uses subdomains: https://boards.greenhouse.io/vimeo/jobs/...
          // or path: https://boards.greenhouse.io/vimeo
          const pathParts = parsedUrl.pathname.split('/').filter(p => p);
          if (pathParts.length > 0) company = pathParts[0];
        } else if (platform === 'lever.co') {
          // lever usually uses path: https://jobs.lever.co/vimeo
          const pathParts = parsedUrl.pathname.split('/').filter(p => p);
          if (pathParts.length > 0) company = pathParts[0];
        } else if (hostParts.length > 2) {
          company = hostParts[0];
        } else if (parsedUrl.pathname.split('/').filter(p => p).length > 0) {
          company = parsedUrl.pathname.split('/').filter(p => p)[0];
        }
      } catch (e) { }

      finalResults.push({
        title: item.title,
        company: company.charAt(0).toUpperCase() + company.slice(1),
        location,
        applyUrl: url,
        platform,
        jobId: url.split('/').pop() || null,
        foundAt: new Date().toISOString(),
        searchQuery: searchTemplate,
      });

      seenUrls.add(url);
      resultsEmitted++;
      estimatedCost += COST_PER_RESULT;
    }
  } catch (error) {
    console.error(`Failed to fetch results for ${platform}:`, error.message);
  }
}

await Actor.pushData(finalResults);
await cache.setValue(cacheKey, { timestamp: Date.now(), results: finalResults });

console.log(`Successfully found and pushed ${finalResults.length} unique job postings.`);
if (limitReached) {
  console.log(`Stopped early to respect max charge limit ($${maxTotalChargeUsd}).`);
}

await Actor.exit();
