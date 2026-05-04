const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const GEO_MAP = {
  2826: { country: 'GB', language: 'en' },
  2840: { country: 'US', language: 'en' },
  2124: { country: 'CA', language: 'en' },
  2036: { country: 'AU', language: 'en' },
  2276: { country: 'DE', language: 'de' },
  2616: { country: 'PL', language: 'pl' },
  2356: { country: 'IN', language: 'en' },
  2076: { country: 'BR', language: 'pt' },
  2484: { country: 'MX', language: 'es' },
  2784: { country: 'AE', language: 'en' },
  2724: { country: 'ES', language: 'es' },
  2380: { country: 'IT', language: 'it' },
  2250: { country: 'FR', language: 'fr' },
  2528: { country: 'NL', language: 'nl' },
  2804: { country: 'UA', language: 'uk' },
  2566: { country: 'NG', language: 'en' },
  2710: { country: 'ZA', language: 'en' },
};

app.post('/api/scrape/google', async (req, res) => {
  const { query, location_code = 2826, pages = 1, mode = 'keyword' } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  if (!APIFY_TOKEN) return res.status(503).json({ error: 'APIFY_TOKEN not configured' });

  const geo = GEO_MAP[location_code] || GEO_MAP[2826];
  const actualPages = Math.min(parseInt(pages) || 1, 5);
  const searchQuery = mode === 'domain' ? `site:${query}` : query;

  console.log(`Scraping: "${searchQuery}" geo=${geo.country} pages=${actualPages}`);

  try {
    // apify/google-search-scraper - correct input format
    const runRes = await axios.post(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=1024`,
      {
        queries: searchQuery,
        maxPagesPerQuery: actualPages,
        resultsPerPage: 10,
        countryCode: geo.country.toLowerCase(),
        languageCode: geo.language,
        includeUnfilteredResults: false,
        mobileResults: false,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
      },
      { timeout: 130000 }
    );

    const items = Array.isArray(runRes.data) ? runRes.data : [];
    console.log(`Returned ${items.length} result pages`);
    if (items[0]) console.log('Keys:', Object.keys(items[0]).join(', '));

    const allAds = [];
    items.forEach(item => {
      const paidResults = item.paidResults || [];
      console.log(`Page ${item.searchQuery?.page || 1}: ${paidResults.length} paid ads`);

      paidResults.forEach((ad, idx) => {
        const url = ad.url || ad.link || '';
        let domain = '';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}

        allAds.push({
          position: ad.adPosition || ad.position || idx + 1,
          title: ad.title || '',
          description: ad.description || ad.snippet || '',
          display_url: ad.displayedUrl || ad.displayLink || domain,
          url,
          domain,
          sitelinks: (ad.siteLinks || ad.sitelinks || []).map(s => ({
            title: s.title || s.text || '',
            url: s.url || s.link || '',
            description: s.snippet || '',
          })),
          callouts: ad.callouts || [],
          extensions: ad.adExtensions || [],
          page: item.searchQuery?.page || 1,
          source: 'apify_google',
          format: 'search',
        });
      });
    });

    const seen = new Set();
    const unique = allAds.filter(ad => {
      if (!ad.url || seen.has(ad.url)) return false;
      seen.add(ad.url);
      return true;
    });

    console.log(`Total unique ads: ${unique.length}`);
    if (unique.length === 0 && items.length > 0) {
      console.log('Full first item:', JSON.stringify(items[0]).slice(0, 600));
    }

    res.json({ success: true, data: { query: searchQuery, geo: geo.country, ads: unique, total: unique.length } });

  } catch(err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    console.error('Error:', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (Apify)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
