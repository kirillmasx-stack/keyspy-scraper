const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = 'apify~google-search-scraper';

const GEO_LOCATIONS = {
  2826: { country: 'gb', location: 'United Kingdom', language: 'en' },
  2840: { country: 'us', location: 'United States',  language: 'en' },
  2124: { country: 'ca', location: 'Canada',         language: 'en' },
  2036: { country: 'au', location: 'Australia',      language: 'en' },
  2276: { country: 'de', location: 'Germany',        language: 'de' },
  2616: { country: 'pl', location: 'Poland',         language: 'pl' },
  2356: { country: 'in', location: 'India',          language: 'en' },
  2076: { country: 'br', location: 'Brazil',         language: 'pt' },
  2484: { country: 'mx', location: 'Mexico',         language: 'es' },
  2784: { country: 'ae', location: 'United Arab Emirates', language: 'en' },
  2724: { country: 'es', location: 'Spain',          language: 'es' },
  2380: { country: 'it', location: 'Italy',          language: 'it' },
  2250: { country: 'fr', location: 'France',         language: 'fr' },
  2528: { country: 'nl', location: 'Netherlands',    language: 'nl' },
  2804: { country: 'ua', location: 'Ukraine',        language: 'uk' },
  2566: { country: 'ng', location: 'Nigeria',        language: 'en' },
  2710: { country: 'za', location: 'South Africa',   language: 'en' },
};

app.post('/api/scrape/google', async (req, res) => {
  const { query, location_code = 2826, pages = 1, mode = 'keyword' } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  if (!APIFY_TOKEN) return res.status(503).json({ error: 'APIFY_TOKEN not configured' });

  const geo = GEO_LOCATIONS[location_code] || GEO_LOCATIONS[2826];
  const actualPages = Math.min(parseInt(pages) || 1, 5);
  const searchQuery = mode === 'domain' ? `site:${query}` : query;

  console.log(`Scraping via Apify: "${searchQuery}" geo=${geo.country} pages=${actualPages}`);

  try {
    // Run actor synchronously (wait for result)
    const runRes = await axios.post(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`,
      {
        queries: searchQuery,
        countryCode: geo.country.toUpperCase(),
        languageCode: geo.language,
        maxPagesPerQuery: actualPages,
        resultsPerPage: 10,
        includeUnfilteredResults: true,
        mobileResults: false,
      },
      { timeout: 130000 }
    );

    const items = Array.isArray(runRes.data) ? runRes.data : [];
    console.log(`Apify returned ${items.length} items`);

    // Parse ads from results
    const allAds = [];
    items.forEach(item => {
      // Paid ads
      const paidAds = item.paidResults || item.ads || item.adResults || [];
      paidAds.forEach((ad, idx) => {
        const url = ad.url || ad.link || ad.displayedUrl || '';
        let domain = '';
        try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); } catch(e) {}

        allAds.push({
          position: idx + 1,
          title: ad.title || ad.heading || '',
          description: ad.description || ad.snippet || ad.text || '',
          display_url: ad.displayedUrl || ad.displayUrl || domain,
          url: ad.url || ad.link || '',
          domain,
          sitelinks: (ad.siteLinks || ad.sitelinks || []).map(s => ({
            title: s.title || s.text || '',
            url: s.url || s.link || '',
          })),
          callouts: ad.callouts || [],
          page: item.page || 1,
          source: 'apify',
          format: 'search',
        });
      });
    });

    // Deduplicate
    const seen = new Set();
    const unique = allAds.filter(ad => {
      if (!ad.url || seen.has(ad.url)) return false;
      seen.add(ad.url);
      return true;
    });

    console.log(`Total unique ads: ${unique.length}`);

    // If no ads found, log raw item structure for debugging
    if (unique.length === 0 && items.length > 0) {
      console.log('Sample item keys:', Object.keys(items[0]).join(', '));
      console.log('Sample item:', JSON.stringify(items[0]).slice(0, 300));
    }

    res.json({ success: true, data: { query: searchQuery, geo: geo.country, ads: unique, total: unique.length, raw_count: items.length } });

  } catch(err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    console.error('Apify error:', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (Apify)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
