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

const results = [];
const seenUrls = new Set();

// Build all queries first to call the scraper once if possible, 
// but calling platform by platform allows better logging and control.
for (const platform of PLATFORMS) {
  console.log(`Searching jobs on ${platform}...`);

  // Construct Google Dork
  const searchTemplate = `site:${platform} "${query}" "${location}"`;

  try {
    const run = await Actor.call('apify/google-search-scraper', {
      queries: searchTemplate,
      maxPagesPerQuery: 1,
      resultsPerPage: maxResultsPerSource,
      mobileResults: false,
      type: 'SEARCH',
      // Google time filter: qdr:dX where X is d (day), w (week), m (month)
      // We'll append it to the queries if we can, but the actor usually handles it via its own params.
      // For apify/google-search-scraper, we can try to use 'extraParams' or similar if supported.
      // A common way is to just add it to the query or use the 'customData' if the actor supports it.
      // Here we use the 'timeRange' if available, otherwise we just build the query.
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
      if (seenUrls.has(url)) continue;

      // Extract company from title or description if possible
      // Most ATS URLs have company name in subdomain or path
      let company = 'Unknown';
      try {
        const parsedUrl = new URL(url);
        const hostParts = parsedUrl.hostname.split('.');
        if (hostParts.length > 2) {
          company = hostParts[0]; // e.g., 'companyname.greenhouse.io'
        } else if (parsedUrl.pathname.split('/').length > 1) {
          company = parsedUrl.pathname.split('/')[1]; // e.g., 'lever.co/companyname'
        }
      } catch (e) {
        // Ignore
      }

      results.push({
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
    }
  } catch (error) {
    console.error(`Failed to fetch results for ${platform}:`, error.message);
  }
}

await Actor.pushData(results);
await cache.setValue(cacheKey, { timestamp: Date.now(), results });

console.log(`Successfully found and pushed ${results.length} unique job postings.`);

await Actor.exit();
