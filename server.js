const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const GEO_MAP = {
  2826: 'GB', 2840: 'US', 2124: 'CA', 2036: 'AU',
  2276: 'DE', 2616: 'PL', 2356: 'IN', 2076: 'BR',
  2484: 'MX', 2784: 'AE', 2724: 'ES', 2380: 'IT',
  2250: 'FR', 2528: 'NL', 2804: 'UA', 2566: 'NG', 2710: 'ZA',
};

app.post('/api/scrape/google', async (req, res) => {
  const { query, location_code = 2826, pages = 1, mode = 'keyword' } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  if (!APIFY_TOKEN) return res.status(503).json({ error: 'APIFY_TOKEN not configured' });

  const country = GEO_MAP[location_code] || 'GB';
  const maxItems = Math.min(parseInt(pages) || 1, 5) * 20;

  // lexis-solutions only works with domain or advertiser URLs
  // For keyword mode: use google-search-scraper with residential proxy
  // For domain mode: use lexis-solutions (Transparency Center)

  if (mode === 'domain') {
    console.log(`Scraping Transparency (domain): "${query}" country=${country}`);
    try {
      const startUrl = `https://adstransparency.google.com/?region=${country}&domain=${encodeURIComponent(query)}`;
      console.log('URL:', startUrl);

      const runRes = await axios.post(
        `https://api.apify.com/v2/acts/lexis-solutions~google-ads-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=1024`,
        {
          startUrls: [{ url: startUrl }],
          maxItems,
          proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        },
        { timeout: 130000 }
      );

      const items = Array.isArray(runRes.data) ? runRes.data : [];
      console.log(`Returned ${items.length} items`);
      if (items[0]) console.log('Sample keys:', Object.keys(items[0]).join(', '));
      if (items[0]) console.log('Sample:', JSON.stringify(items[0]).slice(0, 400));

      const ads = items.map((item, idx) => ({
        position: idx + 1,
        title: item.title || item.headline || item.adTitle || '',
        description: item.description || item.text || item.adText || '',
        display_url: item.displayUrl || item.displayedUrl || item.domain || query,
        url: item.finalUrl || item.advertisersUrl || item.url || '',
        domain: item.domain || query,
        advertiser: item.advertiserName || item.advertiser || '',
        format: item.format || item.adFormat || 'text',
        preview_image: item.previewImageUrl || item.imageUrl || null,
        first_shown: item.firstShown || null,
        last_shown: item.lastShown || null,
        sitelinks: item.sitelinks || [],
        source: 'apify_lexis',
      })).filter(ad => ad.title || ad.description || ad.advertiser);

      return res.json({ success: true, data: { query, country, ads, total: ads.length } });

    } catch(err) {
      const msg = err.response?.data?.error?.message || err.message;
      console.error('Lexis error:', msg);
      return res.status(500).json({ error: msg });
    }
  }

  // Keyword mode — google-search-scraper with residential proxy
  console.log(`Scraping Google Search (keyword): "${query}" country=${country} pages=${pages}`);
  try {
    const geo = { country, language: country === 'UA' ? 'uk' : country === 'BR' ? 'pt' : country === 'DE' ? 'de' : 'en' };

    const runRes = await axios.post(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=1024`,
      {
        queries: query,
        maxPagesPerQuery: Math.min(parseInt(pages) || 1, 5),
        resultsPerPage: 10,
        countryCode: country.toLowerCase(),
        languageCode: geo.language,
        includeUnfilteredResults: false,
        mobileResults: false,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL'],
        },
      },
      { timeout: 130000 }
    );

    const items = Array.isArray(runRes.data) ? runRes.data : [];
    console.log(`Returned ${items.length} result pages`);

    const allAds = [];
    items.forEach(item => {
      const paidResults = item.paidResults || [];
      console.log(`Page ${item.searchQuery?.page || 1}: ${paidResults.length} paid ads`);
      paidResults.forEach((ad, idx) => {
        const url = ad.url || ad.link || '';
        let domain = '';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}
        allAds.push({
          position: ad.adPosition || idx + 1,
          title: ad.title || '',
          description: ad.description || ad.snippet || '',
          display_url: ad.displayedUrl || domain,
          url,
          domain,
          sitelinks: (ad.siteLinks || []).map(s => ({ title: s.title || '', url: s.url || '' })),
          callouts: ad.callouts || [],
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
      console.log('First item paidResults:', JSON.stringify(items[0].paidResults).slice(0, 200));
    }

    res.json({ success: true, data: { query, country, ads: unique, total: unique.length } });

  } catch(err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Error:', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (Apify)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
