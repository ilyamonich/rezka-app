const API_BASE = '/api';
let moviesData = [];

const moviesGrid = document.getElementById('moviesGrid');
const searchInput = document.getElementById('searchInput');
const modal = document.getElementById('playerModal');
const playerFrame = document.getElementById('playerFrame');
const closeBtn = document.querySelector('.close');

// Прокси для постеров
function getPosterUrl(originalUrl) {
    if (!originalUrl) return 'https://via.placeholder.com/200x300?text=No+Image';
    if (originalUrl.startsWith('http')) {
        return `/proxy-poster?url=${encodeURIComponent(originalUrl)}`;
    }
    const fullUrl = originalUrl.startsWith('/') ? `https://rezka-kz.me${originalUrl}` : originalUrl;
    return `/proxy-poster?url=${encodeURIComponent(fullUrl)}`;
}

async function loadPopularMovies() {
    try {
        moviesGrid.innerHTML = '<div class="loader">Загрузка фильмов...</div>';
        const response = await fetch(`${API_BASE}/popular`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        moviesData = await response.json();
        if (!moviesData.length) throw new Error('Нет данных');
        renderMovies(moviesData);
    } catch (error) {
        console.error(error);
        moviesGrid.innerHTML = '<div class="loader">❌ Ошибка загрузки. Попробуйте позже.</div>';
    }
}

function renderMovies(movies) {
    if (!movies.length) {
        moviesGrid.innerHTML = '<div class="loader">😕 Фильмы не найдены</div>';
        return;
    }
    moviesGrid.innerHTML = movies.map(movie => `
        <div class="movie-card" data-url="${escapeHtml(movie.url)}">
            <img class="movie-poster" src="${getPosterUrl(movie.poster)}" alt="${escapeHtml(movie.title)}" loading="lazy" 
                 onerror="this.src='https://via.placeholder.com/200x300?text=Ошибка+загрузки'">
            <div class="movie-title">${escapeHtml(movie.title)}</div>
        </div>
    `).join('');

    document.querySelectorAll('.movie-card').forEach(card => {
        card.addEventListener('click', () => openPlayer(card.dataset.url));
    });
}

function openModal() {
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function closeModal() {
    modal.classList.remove('show');
    document.body.classList.remove('modal-open');
    playerFrame.src = '';
}

async function openPlayer(movieUrl) {
    if (!movieUrl) return;
    openModal();
    playerFrame.src = '';
    playerFrame.srcdoc = '<html><body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100%;margin:0;">Загрузка плеера...</body></html>';
    
    try {
        const response = await fetch(`${API_BASE}/player?url=${encodeURIComponent(movieUrl)}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка сервера');
        }
        const data = await response.json();
        if (data.iframeSrc) {
            playerFrame.src = data.iframeSrc;
        } else {
            throw new Error('Плеер не найден');
        }
    } catch (err) {
        console.error(err);
        playerFrame.srcdoc = `<html><body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100%;margin:0;text-align:center;">❌ Ошибка: ${escapeHtml(err.message)}</body></html>`;
    }
}

function searchMovies(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) {
        renderMovies(moviesData);
        return;
    }
    const filtered = moviesData.filter(movie => movie.title.toLowerCase().includes(lowerQuery));
    renderMovies(filtered);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

closeBtn.onclick = closeModal;
window.onclick = (e) => {
    if (e.target === modal) closeModal();
};

searchInput.addEventListener('input', (e) => {
    searchMovies(e.target.value);
});

loadPopularMovies();
