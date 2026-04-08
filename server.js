const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

const BASE_URL = 'https://rezka-kz.me';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    'Referer': BASE_URL,
};

app.get('/api/popular', async (req, res) => {
    try {
        console.log('Fetching main page...');
        const { data } = await axios.get(BASE_URL, { headers, timeout: 10000 });
        const $ = cheerio.load(data);
        const items = [];

        // Пробуем разные селекторы (адаптация под возможные изменения сайта)
        let movieItems = $('.b-content__inline_item');
        if (movieItems.length === 0) movieItems = $('.short-item, .movie-item, .film-item');
        if (movieItems.length === 0) movieItems = $('.item, .movie, .poster');
        
        console.log(`Found ${movieItems.length} movie items`);

        movieItems.each((i, elem) => {
            let title = '', link = '', poster = '';

            // Способ 1: стандартный
            title = $(elem).find('.b-content__inline_item-link a').text().trim();
            link = $(elem).find('.b-content__inline_item-link a').attr('href');
            poster = $(elem).find('.b-content__inline_item-img img').attr('src');

            // Способ 2: альтернативный
            if (!title) {
                title = $(elem).find('a').first().attr('title') || $(elem).find('a').first().text().trim();
                link = $(elem).find('a').first().attr('href');
                poster = $(elem).find('img').first().attr('src');
            }

            // Способ 3: любые ссылка и картинка
            if (!link) {
                const anyLink = $(elem).find('a').first();
                link = anyLink.attr('href');
                title = anyLink.text().trim() || anyLink.attr('title') || 'Без названия';
                poster = $(elem).find('img').first().attr('src') || $(elem).find('img').attr('data-src');
            }

            if (link && title) {
                if (link.startsWith('/')) link = BASE_URL + link;
                if (!link.startsWith('http')) link = BASE_URL + '/' + link;
                if (poster && poster.startsWith('/')) poster = BASE_URL + poster;
                if (!poster) poster = 'https://via.placeholder.com/200x300?text=No+Image';

                items.push({
                    id: link.split('/').pop().replace('.html', ''),
                    title: title.substring(0, 50),
                    poster: poster,
                    url: link
                });
            }
        });

        console.log(`Extracted ${items.length} items`);
        if (items.length === 0) console.log('HTML sample:', data.substring(0, 500));
        res.json(items.slice(0, 20));
    } catch (err) {
        console.error('Error in /api/popular:', err.message);
        res.status(500).json({ error: 'Failed to fetch movies', details: err.message });
    }
});

app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    try {
        console.log(`Fetching player from: ${url}`);
        const { data } = await axios.get(url, { headers, timeout: 15000 });
        const $ = cheerio.load(data);
        let iframeSrc = null;

        const iframeSelectors = [
            'iframe[src*="player"]',
            'iframe[src*="cdn"]',
            'iframe[src*="video"]',
            'iframe[src*="embed"]',
            '.b-player__embed iframe',
            '#player iframe',
            '.video-player iframe'
        ];

        for (const selector of iframeSelectors) {
            const iframe = $(selector);
            if (iframe.length) {
                iframeSrc = iframe.attr('src');
                if (iframeSrc) break;
            }
        }

        if (!iframeSrc) {
            $('iframe').each((i, elem) => {
                const src = $(elem).attr('src');
                if (src && (src.includes('http') || src.startsWith('//'))) {
                    iframeSrc = src;
                    return false;
                }
            });
        }

        if (!iframeSrc) {
            console.warn(`No iframe found on ${url}`);
            return res.status(404).json({ error: 'Player iframe not found' });
        }

        if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
        if (iframeSrc.startsWith('/')) iframeSrc = BASE_URL + iframeSrc;

        console.log(`Found player: ${iframeSrc}`);
        res.json({ iframeSrc });
    } catch (err) {
        console.error(`Error in /api/player for ${url}:`, err.message);
        res.status(500).json({ error: 'Failed to load player', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
