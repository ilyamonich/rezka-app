const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

const BASE_URL = 'https://rezka-kz.me';

// Глобальная переменная для CSRF-токена (будет получена при первом запросе)
let csrfToken = null;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    'Referer': BASE_URL,
    'X-Requested-With': 'XMLHttpRequest'
};

// Функция для получения CSRF-токена с главной страницы
async function fetchCsrfToken() {
    try {
        const { data } = await axios.get(BASE_URL, {
            headers: { 'User-Agent': headers['User-Agent'] },
            timeout: 10000
        });
        const match = data.match(/csrf-token" content="([^"]+)"/i) ||
                      data.match(/name="csrf-token" value="([^"]+)"/i) ||
                      data.match(/csrf_token\s*=\s*'([^']+)'/i);
        if (match && match[1]) {
            csrfToken = match[1];
            console.log('CSRF token получен:', csrfToken);
            return csrfToken;
        }
        console.warn('CSRF token не найден на главной странице');
        return null;
    } catch (err) {
        console.error('Ошибка получения CSRF токена:', err.message);
        return null;
    }
}

// Вызовем получение токена при старте сервера
fetchCsrfToken();

// Прокси для постеров (с повторными попытками)
app.get('/proxy-poster', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('Missing url');

    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.get(imageUrl, {
                headers: {
                    'User-Agent': headers['User-Agent'],
                    'Referer': BASE_URL
                },
                responseType: 'stream',
                timeout: 15000
            });
            res.set('Content-Type', response.headers['content-type']);
            response.data.pipe(res);
            return;
        } catch (err) {
            console.error(`Попытка ${i+1} прокси постера не удалась:`, err.message);
            if (i === maxRetries - 1) {
                res.status(404).send('Image not found after retries');
            }
        }
    }
});

// Эндпоинт списка фильмов
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

// Получение плеера через AJAX API с CSRF-токеном и translator_id
app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'No URL provided' });

    try {
        // Если токена ещё нет, попробуем получить сейчас
        if (!csrfToken) await fetchCsrfToken();

        // Получаем страницу фильма, чтобы извлечь ID и translator_id
        const { data: pageHtml } = await axios.get(url, { headers, timeout: 15000 });
        const $ = cheerio.load(pageHtml);

        let isSeries = url.includes('/series/');
        let contentId = null;
        let translatorId = '1'; // значение по умолчанию

        // Ищем ID и translator_id в скриптах
        const scripts = $('script').map((i, el) => $(el).html()).get();
        for (const script of scripts) {
            if (!script) continue;
            if (!contentId) {
                const idMatch = script.match(/data-post_id["']?\s*:\s*["']?(\d+)/);
                if (idMatch) contentId = idMatch[1];
            }
            const transMatch = script.match(/data-translator_id["']?\s*:\s*["']?(\d+)/);
            if (transMatch) translatorId = transMatch[1];
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
            apiUrl = `${BASE_URL}/ajax/get_cdn_series/?t=${Date.now()}&id=${contentId}&translator_id=${translatorId}&season=1&episode=1&action=get_episodes`;
        } else {
            apiUrl = `${BASE_URL}/ajax/get_cdn_movie/?t=${Date.now()}&id=${contentId}&translator_id=${translatorId}&action=get_movie`;
        }

        console.log(`Requesting player API: ${apiUrl}`);
        const playerResponse = await axios.get(apiUrl, {
            headers: {
                ...headers,
                'Referer': url,
                'X-CSRF-TOKEN': csrfToken || '',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            },
            timeout: 10000
        });

        console.log('API response:', JSON.stringify(playerResponse.data, null, 2));

        let iframeSrc = null;
        const data = playerResponse.data;

        // Парсим разные форматы ответа
        if (data && typeof data === 'object') {
            if (data.success && data.data) {
                if (data.data.url) iframeSrc = data.data.url;
                else if (data.data.file) iframeSrc = data.data.file;
                else if (data.data.video) {
                    if (data.data.video.url) iframeSrc = data.data.video.url;
                    else if (data.data.video['720p']) iframeSrc = data.data.video['720p'];
                    else if (data.data.video['480p']) iframeSrc = data.data.video['480p'];
                }
            } else if (data.url) iframeSrc = data.url;
            else if (data.video) {
                if (data.video.url) iframeSrc = data.video.url;
                else if (data.video['720p']) iframeSrc = data.video['720p'];
            } else if (data.file) iframeSrc = data.file;
            else if (data.link) iframeSrc = data.link;
        } else if (typeof data === 'string') {
            const match = data.match(/<iframe[^>]+src=["']([^"']+)["']/);
            if (match) iframeSrc = match[1];
        }

        if (!iframeSrc) {
            console.error('No player URL found');
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
