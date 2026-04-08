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
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    'Referer': BASE_URL,
    'X-Requested-With': 'XMLHttpRequest'
};

// Прокси для постеров (обходит защиту от горячих ссылок)
app.get('/proxy-poster', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('Missing url');
    try {
        const response = await axios.get(imageUrl, {
            headers: {
                'User-Agent': headers['User-Agent'],
                'Referer': BASE_URL
            },
            responseType: 'stream'
        });
        res.set('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (err) {
        console.error('Poster proxy error:', err.message);
        res.status(404).send('Image not found');
    }
});

// Получение списка популярных фильмов/сериалов
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
        res.json(items.slice(0, 20));
    } catch (err) {
        console.error('Error in /api/popular:', err.message);
        res.status(500).json({ error: 'Failed to fetch movies' });
    }
});

// Получение плеера через AJAX API сайта
app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    try {
        // Загружаем страницу фильма для извлечения ID
        const { data: pageHtml } = await axios.get(url, { headers, timeout: 15000 });
        const $ = cheerio.load(pageHtml);

        let isSeries = url.includes('/series/');
        let contentId = null;

        // Пытаемся найти ID в скриптах
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
            throw new Error('Could not extract content ID');
        }

        let apiUrl = '';
        if (isSeries) {
            // Для сериалов нужно также парсить сезон/серию (пока берём по умолчанию)
            apiUrl = `${BASE_URL}/ajax/get_cdn_series/?t=${Date.now()}&id=${contentId}&season=1&episode=1&action=get_episodes`;
        } else {
            apiUrl = `${BASE_URL}/ajax/get_cdn_movie/?t=${Date.now()}&id=${contentId}&action=get_movie`;
        }

        console.log(`Requesting player API: ${apiUrl}`);
        const playerResponse = await axios.get(apiUrl, {
            headers: {
                ...headers,
                'Referer': url,
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            },
            timeout: 10000
        });

        // Логируем полный ответ для отладки (важно для выявления структуры)
        console.log('API response:', JSON.stringify(playerResponse.data, null, 2));

        let iframeSrc = null;
        const data = playerResponse.data;

        // Универсальный парсер ответа
        if (data && typeof data === 'object') {
            if (data.url) iframeSrc = data.url;
            else if (data.video) {
                if (data.video.url) iframeSrc = data.video.url;
                else if (data.video['720p']) iframeSrc = data.video['720p'];
                else if (data.video['480p']) iframeSrc = data.video['480p'];
                else if (data.video['360p']) iframeSrc = data.video['360p'];
            }
            else if (data.source) iframeSrc = data.source;
            else if (data.file) iframeSrc = data.file;
            else if (data.link) iframeSrc = data.link;
            else if (data.iframe) iframeSrc = data.iframe;
            else if (Array.isArray(data.sources) && data.sources[0]) {
                iframeSrc = data.sources[0].file || data.sources[0].url;
            }
            else if (data.success && data.data) {
                iframeSrc = data.data.url || data.data.file;
            }
        } else if (typeof data === 'string') {
            const match = data.match(/<iframe[^>]+src=["']([^"']+)["']/);
            if (match) iframeSrc = match[1];
        }

        if (!iframeSrc) {
            console.error('No player URL found in API response');
            return res.status(404).json({ error: 'Player URL not found', rawResponse: data });
        }

        if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
        console.log(`Player URL extracted: ${iframeSrc}`);
        res.json({ iframeSrc });
    } catch (err) {
        console.error(`Error in /api/player:`, err.message);
        res.status(500).json({ error: 'Failed to load player', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
