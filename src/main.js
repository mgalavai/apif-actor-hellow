import { Actor } from 'apify';
import crypto from 'crypto';
import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

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
// Based on Google SERP Proxy @ $2.5/1k requests and compute usage.
const ACTOR_START_COST = 0.00005;
const COST_PER_RESULT = 0.0001; // Approx $0.10 per 1k results

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

// Setup Proxy for GOOGLE_SERP
const proxyConfiguration = await Actor.createProxyConfiguration({
  groups: ['GOOGLE_SERP'],
});

const finalResults = [];
const seenUrls = new Set();
let limitReached = false;

for (const platform of PLATFORMS) {
  if (limitReached) break;
  console.log(`Searching jobs on ${platform} using Google SERP Proxy...`);

  const searchTemplate = `site:${platform} "${query}" "${location}"`;
  const searchUrl = `http://www.google.com/search?q=${encodeURIComponent(searchTemplate)}&hl=en&num=100`;

  try {
    const response = await gotScraping({
      url: searchUrl,
      proxyUrl: await proxyConfiguration.newUrl(),
      headerGeneratorOptions: {
        browsers: [
          { name: 'chrome', minVersion: 87 },
          { name: 'firefox', minVersion: 80 },
          { name: 'safari', minVersion: 13 },
        ],
        devices: ['desktop'],
        locales: ['en-US'],
      },
      retry: { limit: 3 },
    });

    const $ = cheerio.load(response.body);
    const searchResults = [];

    // Debug: Log a snippet of the HTML to understand structure
    console.log(`HTML snippet (first 500 chars): ${response.body.substring(0, 500)}`);

    // Try multiple selectors for Google search results
    // Modern Google uses different structures depending on the query type
    const selectors = [
      'div.g',           // Classic desktop results
      'div[data-sokoban-container]', // New structure
      '.Gx5Zad.fP1Qef.xpd.EtOod.pkphOe', // Another variant
      'div[jscontroller]', // Generic fallback
    ];

    let foundAny = false;
    for (const selector of selectors) {
      const count = $(selector).length;
      if (count > 0) {
        console.log(`Selector "${selector}" found ${count} elements`);
        foundAny = true;

        $(selector).each((i, el) => {
          // Try to find title (h3 is common across all structures)
          const titleEl = $(el).find('h3').first();
          const title = titleEl.text().trim();

          // Try to find the link (usually an <a> tag with href)
          const linkEl = $(el).find('a[href]').first();
          let url = linkEl.attr('href');

          // Google sometimes uses /url?q= redirects, extract the actual URL
          if (url && url.startsWith('/url?')) {
            const urlParams = new URLSearchParams(url.substring(5));
            url = urlParams.get('q') || url;
          }

          if (title && url && !url.startsWith('/')) {
            searchResults.push({ title, url });
          }
        });

        if (searchResults.length > 0) {
          console.log(`Successfully extracted ${searchResults.length} results using selector: ${selector}`);
          break; // Stop trying other selectors
        }
      }
    }

    if (!foundAny) {
      console.warn(`No elements found with any selector. Saving HTML for inspection...`);
      await cache.setValue(`debug_html_${platform}`, response.body);
    }

    console.log(`Found ${searchResults.length} potential results for ${platform}.`);

    let resultsFromThisPlatform = 0;
    for (const item of searchResults) {
      // Enforce maxResultsPerSource limit
      if (resultsFromThisPlatform >= maxResultsPerSource) {
        console.log(`Reached max results limit (${maxResultsPerSource}) for ${platform}.`);
        break;
      }
      const url = normalizeUrl(item.url);

      // Validation: Ensure the URL is actually on the target platform and not a Google link
      if (url.includes('google.com') || !url.includes(platform)) {
        continue;
      }

      if (seenUrls.has(url)) continue;

      if (!canEmitAnotherResult()) {
        console.log(`Cost limit reached ($${maxTotalChargeUsd}). Stopping early.`);
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
        } else {
          const pathParts = parsedUrl.pathname.split('/').filter(p => p);
          if (pathParts.length > 0) company = pathParts[0];
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
      resultsFromThisPlatform++;
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
