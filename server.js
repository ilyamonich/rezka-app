const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static('public'));

// Базовый URL сайта
const BASE_URL = 'https://rezka-kz.me';

// Получение списка популярных фильмов/сериалов с главной
app.get('/api/popular', async (req, res) => {
    try {
        const { data } = await axios.get(BASE_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const $ = cheerio.load(data);
        const items = [];

        // Селекторы (актуальны для структуры rezka-kz.me на момент написания)
        $('.b-content__inline_item').each((i, elem) => {
            const titleElem = $(elem).find('.b-content__inline_item-link a');
            const title = titleElem.text().trim();
            const link = titleElem.attr('href');
            const poster = $(elem).find('.b-content__inline_item-img img').attr('src');
            
            if (title && link) {
                items.push({
                    id: link.split('/').pop().replace('.html', ''),
                    title,
                    poster: poster || '/no-poster.jpg',
                    url: link.startsWith('http') ? link : BASE_URL + link
                });
            }
        });

        res.json(items.slice(0, 20)); // первые 20
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка парсинга' });
    }
});

// Получение iframe плеера для конкретного фильма/сериала
app.get('/api/player', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL не указан' });

    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const $ = cheerio.load(data);
        
        // Ищем iframe плеера
        let iframeSrc = null;
        $('iframe').each((i, elem) => {
            const src = $(elem).attr('src');
            if (src && (src.includes('cdn') || src.includes('player') || src.includes('video'))) {
                iframeSrc = src;
                return false;
            }
        });
        
        // Альтернативный поиск в блоках плеера
        if (!iframeSrc) {
            const playerDiv = $('.b-player__embed');
            if (playerDiv.length) {
                const iframe = playerDiv.find('iframe');
                iframeSrc = iframe.attr('src');
            }
        }

        if (!iframeSrc) {
            return res.status(404).json({ error: 'Плеер не найден на странице' });
        }

        // Приводим ссылку к абсолютной
        if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
        if (iframeSrc.startsWith('/')) iframeSrc = BASE_URL + iframeSrc;

        res.json({ iframeSrc });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка загрузки страницы фильма' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
