const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Render сам подставляет PORT

app.use(cors());
app.use(express.static('public'));

const BASE_URL = 'https://rezka-kz.me';

// Улучшенные заголовки, чтобы сайт думал, что запрос идёт от реального браузера
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    'Referer': BASE_URL,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

// Эндпоинт для получения списка популярных фильмов/сериалов
app.get('/api/popular', async (req, res) => {
    try {
        console.log('Парсинг главной страницы...');
        const { data } = await axios.get(BASE_URL, { headers });
        const $ = cheerio.load(data);
        const items = [];

        // Селектор блока с фильмом (актуально для rezka-kz.me)
        $('.b-content__inline_item').each((i, elem) => {
            const titleElem = $(elem).find('.b-content__inline_item-link a');
            const title = titleElem.text().trim();
            const link = titleElem.attr('href');
            const poster = $(elem).find('.b-content__inline_item-img img').attr('src');

            if (title && link) {
                items.push({
                    id: link.split('/').pop().replace('.html', ''),
                    title,
                    poster: poster || 'https://via.placeholder.com/200x300?text=No+Poster',
                    url: link.startsWith('http') ? link : BASE_URL + link
                });
            }
        });

        console.log(`Найдено ${items.length} фильмов`);
        res.json(items.slice(0, 20)); // первые 20
    } catch (err) {
        console.error('Ошибка в /api/popular:', err.message);
        res.status(500).json({ error: 'Не удалось загрузить список фильмов', details: err.message });
    }
});

// Эндпоинт для получения iframe плеера по URL фильма
app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Не передан URL фильма' });
    }

    try {
        console.log(`Загрузка страницы фильма: ${url}`);
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);
        let iframeSrc = null;

        // Ищем iframe плеера
        $('iframe').each((i, elem) => {
            const src = $(elem).attr('src');
            if (src && (src.includes('cdn') || src.includes('player') || src.includes('video') || src.includes('embed'))) {
                iframeSrc = src;
                return false; // прерываем цикл
            }
        });

        // Альтернативный поиск в специальном блоке
        if (!iframeSrc) {
            const playerDiv = $('.b-player__embed');
            if (playerDiv.length) {
                const iframe = playerDiv.find('iframe');
                iframeSrc = iframe.attr('src');
            }
        }

        if (!iframeSrc) {
            console.warn(`Плеер не найден на странице ${url}`);
            return res.status(404).json({ error: 'Плеер не найден на странице' });
        }

        // Приводим ссылку к абсолютной
        if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
        if (iframeSrc.startsWith('/')) iframeSrc = BASE_URL + iframeSrc;

        console.log(`Найден плеер: ${iframeSrc}`);
        res.json({ iframeSrc });
    } catch (err) {
        console.error(`Ошибка в /api/player для URL ${url}:`, err.message);
        res.status(500).json({ error: 'Ошибка загрузки страницы с плеером', details: err.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT}`);
});
