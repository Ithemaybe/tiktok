const TIKWM_API = 'https://tikwm.com/api/';
const CACHE_TTL = 5 * 60 * 1000;

let currentVideoUrl = '';
let currentAudioUrl = '';

const cache = {
  videoBlob: null,
  audioBlob: null,
  videoName: 'tiktok-video.mp4',
  audioName: 'tiktok-audio.mp3',
  timer: null,

  set(videoBlob, audioBlob, title) {
    this.clear();
    this.videoBlob = videoBlob;
    this.audioBlob = audioBlob;
    this.videoName = (title || 'tiktok-video').slice(0, 60).replace(/[^\w\s-]/g, '') + '.mp4';
    this.audioName = (title || 'tiktok-audio').slice(0, 60).replace(/[^\w\s-]/g, '') + '.mp3';
    this.timer = setTimeout(() => this.clear(), CACHE_TTL);
  },

  clear() {
    if (this.videoBlob) { URL.revokeObjectURL(this.videoBlob); this.videoBlob = null; }
    if (this.audioBlob) { URL.revokeObjectURL(this.audioBlob); this.audioBlob = null; }
    if (this.timer)     { clearTimeout(this.timer); this.timer = null; }
  },

  hasVideo() { return !!this.videoBlob; },
  hasAudio() { return !!this.audioBlob; },
};

function isTikTokUrl(raw) {
  try {
    const u = new URL(raw);
    return /tiktok\.com$/i.test(u.hostname)    ||
           /vm\.tiktok\.com$/i.test(u.hostname) ||
           /vt\.tiktok\.com$/i.test(u.hostname);
  } catch { return false; }
}

function triggerSave(blobUrl, filename) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function urlToBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function fetchTikTokData(url) {
  const res  = await fetch(`${TIKWM_API}?url=${encodeURIComponent(url)}&hd=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) throw new Error(json.msg || 'Видео не найдено');

  return {
    title:  json.data.title  || '',
    author: json.data.author?.unique_id || json.data.author?.nickname || '',
    cover:  json.data.cover  || '',
    video:  json.data.play   || json.data.wmplay || '',
    audio:  json.data.music  || '',
  };
}

window.addEventListener('DOMContentLoaded', () => {

  const urlInput     = document.getElementById('urlInput');
  const pasteBtn     = document.getElementById('pasteBtn');
  const dlBtn        = document.getElementById('dlBtn');
  const btnText      = dlBtn.querySelector('.btn-text');
  const spinner      = document.getElementById('spinner');
  const errorMsg     = document.getElementById('errorMsg');
  const resultCard   = document.getElementById('resultCard');
  const thumbWrap    = document.getElementById('thumbWrap');
  const resultTitle  = document.getElementById('resultTitle');
  const resultAuthor = document.getElementById('resultAuthor');
  const videoBtn     = document.getElementById('videoBtn');
  const audioBtn     = document.getElementById('audioBtn');
  const videoBtnText = document.getElementById('videoBtnText');
  const audioBtnText = document.getElementById('audioBtnText');
  const videoSpinner = document.getElementById('videoSpinner');
  const audioSpinner = document.getElementById('audioSpinner');

  function setMainLoading(on) {
    dlBtn.disabled        = on;
    btnText.style.display = on ? 'none'  : 'block';
    spinner.style.display = on ? 'block' : 'none';
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('visible');
    urlInput.classList.add('error');
  }

  function clearError() {
    errorMsg.classList.remove('visible');
    urlInput.classList.remove('error');
  }

  function setActBtn(btn, textEl, spin, { loading = false, enabled = true } = {}) {
    btn.disabled         = loading || !enabled;
    btn.style.opacity    = enabled ? '1' : '0.35';
    textEl.style.display = loading ? 'none'  : 'inline';
    spin.style.display   = loading ? 'block' : 'none';
  }

  function showResult(data) {
    thumbWrap.innerHTML = data.cover
      ? `<img src="${data.cover}" alt="" loading="lazy">`
      : `<div class="thumb-placeholder">
           <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
             <polygon points="5 3 19 12 5 21 5 3"/>
           </svg>
         </div>`;

    resultTitle.textContent  = data.title  || 'TikTok видео';
    resultAuthor.textContent = data.author ? '@' + data.author : '@unknown';

    setActBtn(videoBtn, videoBtnText, videoSpinner, { enabled: cache.hasVideo() });
    setActBtn(audioBtn, audioBtnText, audioSpinner, { enabled: cache.hasAudio() });

    resultCard.classList.add('visible');
  }

  function hideResult() {
    resultCard.classList.remove('visible');
    cache.clear();
  }

  async function handleDownload() {
    const raw = urlInput.value.trim();
    clearError();
    hideResult();

    if (!raw) {
      urlInput.classList.add('error');
      setTimeout(() => urlInput.classList.remove('error'), 900);
      urlInput.focus();
      return;
    }

    if (!isTikTokUrl(raw)) {
      showError('Это не ссылка TikTok. Проверьте адрес и попробуйте снова.');
      return;
    }

    setMainLoading(true);

    try {
      const data = await fetchTikTokData(raw);

      const [videoBlob, audioBlob] = await Promise.all([
        data.video ? urlToBlob(data.video) : Promise.resolve(null),
        data.audio ? urlToBlob(data.audio) : Promise.resolve(null),
      ]);

      cache.set(videoBlob, audioBlob, data.title);
      showResult(data);
    } catch (err) {
      showError(
        err.message?.includes('HTTP')
          ? 'Сервер недоступен. Попробуйте позже.'
          : (err.message || 'Не удалось получить данные. Попробуйте ещё раз.')
      );
    } finally {
      setMainLoading(false);
    }
  }

  videoBtn.addEventListener('click', () => {
    if (cache.hasVideo()) triggerSave(cache.videoBlob, cache.videoName);
  });

  audioBtn.addEventListener('click', () => {
    if (cache.hasAudio()) triggerSave(cache.audioBlob, cache.audioName);
  });

  dlBtn.addEventListener('click', handleDownload);

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleDownload();
  });

  urlInput.addEventListener('input', () => {
    clearError();
    hideResult();
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        clearError();
        hideResult();
        urlInput.focus();
      }
    } catch {
      urlInput.focus();
    }
  });

});
