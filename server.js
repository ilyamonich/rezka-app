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

// Прокси для загрузки постеров (обходит блокировку по Referer)
app.get('/proxy-poster', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) {
        return res.status(400).send('Missing url parameter');
    }
    try {
        const response = await axios.get(imageUrl, {
            headers: {
                'User-Agent': headers['User-Agent'],
                'Referer': BASE_URL
            },
            responseType: 'stream',
            timeout: 10000
        });
        res.set('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (err) {
        console.error('Poster proxy error:', err.message);
        res.status(404).send('Image not found');
    }
});

// Эндпоинт для получения списка популярных фильмов
app.get('/api/popular', async (req, res) => {
    try {
        console.log('Fetching main page...');
        const { data } = await axios.get(BASE_URL, { headers, timeout: 10000 });
        const $ = cheerio.load(data);
        const items = [];

        let movieItems = $('.b-content__inline_item');
        if (movieItems.length === 0) movieItems = $('.short-item, .movie-item, .film-item');

        movieItems.each((i, elem) => {
            let title = '', link = '', poster = '';
            title = $(elem).find('.b-content__inline_item-link a').text().trim();
            link = $(elem).find('.b-content__inline_item-link a').attr('href');
            poster = $(elem).find('.b-content__inline_item-img img').attr('src');

            if (!title) {
                title = $(elem).find('a').first().attr('title') || $(elem).find('a').first().text().trim();
                link = $(elem).find('a').first().attr('href');
                poster = $(elem).find('img').first().attr('src');
            }

            if (link && title) {
                if (link.startsWith('/')) link = BASE_URL + link;
                if (poster && poster.startsWith('/')) poster = BASE_URL + poster;
                if (!poster) poster = '';
                items.push({
                    id: link.split('/').pop().replace('.html', ''),
                    title: title.substring(0, 50),
                    poster: poster,
                    url: link
                });
            }
        });

        console.log(`Extracted ${items.length} items`);
        res.json(items.slice(0, 20));
    } catch (err) {
        console.error('Error in /api/popular:', err.message);
        res.status(500).json({ error: 'Failed to fetch movies' });
    }
});

// Эндпоинт для получения iframe плеера через AJAX API сайта
app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    try {
        const { data: pageHtml } = await axios.get(url, { headers, timeout: 15000 });
        const $ = cheerio.load(pageHtml);

        const isSeries = url.includes('/series/');
        let contentId = null;

        // Ищем ID в скриптах или data-атрибутах
        const scriptWithId = $('script:contains("data-post_id")').html() || $('script:contains("post_id")').html();
        if (scriptWithId) {
            const match = scriptWithId.match(/data-post_id["']?\s*:\s*["']?(\d+)/);
            if (match) contentId = match[1];
        }
        if (!contentId) {
            const urlMatch = url.match(/(\d+)-[^\/]+\.html$/);
            if (urlMatch) contentId = urlMatch[1];
        }

        if (!contentId) {
            throw new Error('Не удалось определить ID контента');
        }

        let playerUrl = '';
        if (isSeries) {
            // Для сериалов берём первый сезон и первую серию (упрощённо)
            let season = 1, episode = 1;
            const activeSeason = $('.b-simple_select__item.active, .b-series__item.active').first();
            if (activeSeason.length) {
                season = activeSeason.data('season') || 1;
                episode = activeSeason.data('episode') || 1;
            }
            playerUrl = `${BASE_URL}/ajax/get_cdn_series/?t=${Date.now()}&id=${contentId}&season=${season}&episode=${episode}&action=get_episodes`;
        } else {
            playerUrl = `${BASE_URL}/ajax/get_cdn_movie/?t=${Date.now()}&id=${contentId}&action=get_movie`;
        }

        console.log(`Requesting player API: ${playerUrl}`);

        const playerResponse = await axios.get(playerUrl, {
            headers: {
                ...headers,
                'Referer': url,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            },
            timeout: 10000
        });

        let iframeSrc = null;
        const data = playerResponse.data;
        if (data && data.url) {
            iframeSrc = data.url;
        } else if (data && data.video && data.video.url) {
            iframeSrc = data.video.url;
        } else if (typeof data === 'string') {
            const iframeMatch = data.match(/<iframe[^>]+src=["']([^"']+)["']/);
            if (iframeMatch) iframeSrc = iframeMatch[1];
        }

        if (!iframeSrc) {
            console.warn(`No player URL in response for ${url}`);
            return res.status(404).json({ error: 'Плеер не найден' });
        }

        if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
        console.log(`Player found: ${iframeSrc}`);
        res.json({ iframeSrc });
    } catch (err) {
        console.error(`Error in /api/player:`, err.message);
        res.status(500).json({ error: 'Ошибка загрузки плеера', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
