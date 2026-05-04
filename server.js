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

  console.log(`Scraping via Apify lexis: "${query}" country=${country} maxItems=${maxItems}`);

  try {
    // Build Google Ads Transparency search URL
    const searchUrl = mode === 'domain'
      ? `https://adstransparency.google.com/?region=${country}&domain=${encodeURIComponent(query)}`
      : `https://adstransparency.google.com/?region=${country}&searchTerm=${encodeURIComponent(query)}`;

    const runRes = await axios.post(
      `https://api.apify.com/v2/acts/lexis-solutions~google-ads-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=1024`,
      {
        startUrls: [{ url: searchUrl }],
        maxItems,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
      },
      { timeout: 130000 }
    );

    const items = Array.isArray(runRes.data) ? runRes.data : [];
    console.log(`Apify returned ${items.length} items`);
    if (items[0]) console.log('Sample keys:', Object.keys(items[0]).join(', '));
    if (items[0]) console.log('Sample:', JSON.stringify(items[0]).slice(0, 400));

    const allAds = items.map((item, idx) => {
      const url = item.advertisersUrl || item.url || item.link || '';
      let domain = '';
      try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); } catch(e) {}

      return {
        position: idx + 1,
        title: item.title || item.headline || item.adTitle || '',
        description: item.description || item.text || item.adText || '',
        display_url: item.displayUrl || item.displayedUrl || domain,
        url: item.finalUrl || item.url || url,
        domain: item.domain || domain,
        advertiser: item.advertiserName || item.advertiser || '',
        format: item.format || item.adFormat || 'text',
        preview_image: item.previewImageUrl || item.imageUrl || null,
        first_shown: item.firstShown || item.startDate || null,
        last_shown: item.lastShown || item.endDate || null,
        sitelinks: item.sitelinks || [],
        callouts: item.callouts || [],
        source: 'apify_lexis',
      };
    }).filter(ad => ad.title || ad.description || ad.advertiser);

    // Deduplicate
    const seen = new Set();
    const unique = allAds.filter(ad => {
      const key = ad.url || ad.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Total unique ads: ${unique.length}`);
    res.json({ success: true, data: { query, country, ads: unique, total: unique.length } });

  } catch(err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    console.error('Error:', msg);
    if (err.response?.data) console.error('Response:', JSON.stringify(err.response.data).slice(0, 300));
    res.status(500).json({ error: msg });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'KeySpy Scraper (Apify Lexis)' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KeySpy Scraper running on port ${PORT}`));
