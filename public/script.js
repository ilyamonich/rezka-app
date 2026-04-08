const API_BASE = '/api';
let moviesData = [];

const moviesGrid = document.getElementById('moviesGrid');
const searchInput = document.getElementById('searchInput');
const modal = document.getElementById('playerModal');
const playerFrame = document.getElementById('playerFrame');
const closeBtn = document.querySelector('.close');

// Загружаем популярные фильмы
async function loadPopularMovies() {
    try {
        moviesGrid.innerHTML = '<div class="loader">Загрузка...</div>';
        const response = await fetch(`${API_BASE}/popular`);
        if (!response.ok) throw new Error('Ошибка загрузки');
        moviesData = await response.json();
        renderMovies(moviesData);
    } catch (error) {
        console.error(error);
        moviesGrid.innerHTML = '<div class="loader">❌ Не удалось загрузить фильмы. Проверьте соединение или селекторы парсинга.</div>';
    }
}

// Рендер сетки
function renderMovies(movies) {
    if (!movies.length) {
        moviesGrid.innerHTML = '<div class="loader">😕 Ничего не найдено</div>';
        return;
    }
    moviesGrid.innerHTML = movies.map(movie => `
        <div class="movie-card" data-url="${movie.url}">
            <img class="movie-poster" src="${movie.poster}" alt="${movie.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x300?text=No+Poster'">
            <div class="movie-title">${escapeHtml(movie.title)}</div>
        </div>
    `).join('');

    // Добавляем обработчики кликов
    document.querySelectorAll('.movie-card').forEach(card => {
        card.addEventListener('click', () => openPlayer(card.dataset.url));
    });
}

// Открыть плеер в модалке
async function openPlayer(movieUrl) {
    if (!movieUrl) return;
    
    // Показываем модалку с загрузкой
    modal.style.display = 'flex';
    playerFrame.src = ''; // очищаем
    playerFrame.style.height = '100%';
    
    try {
        const response = await fetch(`${API_BASE}/player?url=${encodeURIComponent(movieUrl)}`);
        if (!response.ok) throw new Error('Не удалось получить плеер');
        const data = await response.json();
        if (data.iframeSrc) {
            playerFrame.src = data.iframeSrc;
        } else {
            playerFrame.srcdoc = '<html style="background:#000;color:white;display:flex;align-items:center;justify-content:center;height:100%;"><p>Плеер не найден 😞</p></html>';
        }
    } catch (err) {
        console.error(err);
        playerFrame.srcdoc = '<html style="background:#000;color:white;display:flex;align-items:center;justify-content:center;height:100%;"><p>Ошибка загрузки видео</p></html>';
    }
}

// Поиск по названию
function searchMovies(query) {
    const lowerQuery = query.toLowerCase();
    const filtered = moviesData.filter(movie => movie.title.toLowerCase().includes(lowerQuery));
    renderMovies(filtered);
}

// Защита от XSS
function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Закрытие модалки
closeBtn.onclick = () => {
    modal.style.display = 'none';
    playerFrame.src = ''; // останавливаем видео
};
window.onclick = (e) => {
    if (e.target === modal) {
        modal.style.display = 'none';
        playerFrame.src = '';
    }
};

// Обработчик поиска
searchInput.addEventListener('input', (e) => {
    searchMovies(e.target.value);
});

// Запуск
loadPopularMovies();
