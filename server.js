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

// Эндпоинт для списка фильмов (без изменений, работает)
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

// НОВЫЙ эндпоинт для получения плеера через AJAX API сайта
app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    try {
        // 1. Загружаем страницу фильма, чтобы вытащить ID и тип (фильм/сериал)
        const { data: pageHtml } = await axios.get(url, { headers, timeout: 15000 });
        const $ = cheerio.load(pageHtml);

        // Определяем тип контента
        let isSeries = url.includes('/series/');
        let contentId = null;
        let season = 1;
        let episode = 1;

        // Ищем ID в атрибутах или скриптах
        const scriptWithId = $('script:contains("data-post_id")').html() || $('script:contains("post_id")').html();
        if (scriptWithId) {
            const match = scriptWithId.match(/data-post_id["']?\s*:\s*["']?(\d+)/);
            if (match) contentId = match[1];
        }
        if (!contentId) {
            // Альтернатива: из URL (последние цифры перед .html)
            const urlMatch = url.match(/(\d+)-[^\/]+\.html$/);
            if (urlMatch) contentId = urlMatch[1];
        }

        if (!contentId) {
            throw new Error('Не удалось определить ID фильма');
        }

        let playerUrl = '';
        if (isSeries) {
            // Для сериалов нужно также узнать сезон и серию (берём первые доступные)
            // Парсим блок с сезонами/сериями
            const seasonElem = $('.b-simple_select__item.active, .b-series__item.active').first();
            if (seasonElem.length) {
                season = seasonElem.data('season') || 1;
                episode = seasonElem.data('episode') || 1;
            }
            playerUrl = `${BASE_URL}/ajax/get_cdn_series/?t=${Date.now()}&id=${contentId}&season=${season}&episode=${episode}&action=get_episodes`;
        } else {
            playerUrl = `${BASE_URL}/ajax/get_cdn_movie/?t=${Date.now()}&id=${contentId}&action=get_movie`;
        }

        console.log(`Requesting player API: ${playerUrl}`);

        // 2. Запрашиваем данные плеера через AJAX
        const playerResponse = await axios.get(playerUrl, {
            headers: {
                ...headers,
                'Referer': url,
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            },
            timeout: 10000
        });

        let iframeSrc = null;
        if (playerResponse.data && playerResponse.data.url) {
            iframeSrc = playerResponse.data.url;
        } else if (playerResponse.data && playerResponse.data.video && playerResponse.data.video.url) {
            iframeSrc = playerResponse.data.video.url;
        } else if (typeof playerResponse.data === 'string') {
            // Иногда возвращается HTML с iframe
            const iframeMatch = playerResponse.data.match(/<iframe[^>]+src=["']([^"']+)["']/);
            if (iframeMatch) iframeSrc = iframeMatch[1];
        }

        if (!iframeSrc) {
            console.warn(`No player URL in response for ${url}`);
            return res.status(404).json({ error: 'Плеер не найден. Возможно, изменилось API сайта.' });
        }

        if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
        console.log(`Player found: ${iframeSrc}`);
        res.json({ iframeSrc });
    } catch (err) {
        console.error(`Error in /api/player:`, err.message);
        res.status(500).json({ error: 'Не удалось загрузить плеер', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
