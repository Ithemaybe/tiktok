const TIKWM_API = 'https://tikwm.com/api/';
const CACHE_TTL = 5 * 60 * 1000;

const cache = {
  videoBlob:     null,
  audioBlob:     null,  // аудио извлечённое из видео (отрывок)
  fullMusicBlob: null,  // полный трек из music_info
  videoName:     'tiktok-video.mp4',
  audioName:     'tiktok-audio.webm',
  fullMusicName: 'tiktok-full-music.mp3',
  timer: null,

  set(videoBlob, audioBlob, fullMusicBlob, title, musicTitle) {
    this.clear();
    this.videoBlob     = videoBlob;
    this.audioBlob     = audioBlob;
    this.fullMusicBlob = fullMusicBlob;
    const safe = s => (s || '').slice(0, 60).replace(/[^\w\s-]/g, '');
    this.videoName     = (safe(title)      || 'tiktok-video')      + '.mp4';
    this.audioName     = (safe(title)      || 'tiktok-audio')      + '-audio.webm';
    this.fullMusicName = (safe(musicTitle) || safe(title) || 'tiktok-full-music') + '.mp3';
    this.timer = setTimeout(() => this.clear(), CACHE_TTL);
  },

  clear() {
    if (this.videoBlob)     { URL.revokeObjectURL(this.videoBlob);     this.videoBlob     = null; }
    if (this.audioBlob)     { URL.revokeObjectURL(this.audioBlob);     this.audioBlob     = null; }
    if (this.fullMusicBlob) { URL.revokeObjectURL(this.fullMusicBlob); this.fullMusicBlob = null; }
    if (this.timer)         { clearTimeout(this.timer); this.timer = null; }
  },

  hasVideo()     { return !!this.videoBlob; },
  hasAudio()     { return !!this.audioBlob; },
  hasFullMusic() { return !!this.fullMusicBlob; },
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

// Извлекает аудио-дорожку из видео через Web Audio API + MediaRecorder.
// Видео воспроизводится тихо (volume=0), аудио поток пишется в MediaRecorder.
async function extractAudioFromVideo(videoUrl) {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf      = await res.arrayBuffer();
  const vidBlob  = new Blob([buf], { type: 'video/mp4' });
  const blobUrl  = URL.createObjectURL(vidBlob);

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src         = blobUrl;
    video.crossOrigin = 'anonymous';
    video.preload     = 'auto';
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;';
    document.body.appendChild(video);

    const cleanup = (audioCtx) => {
      URL.revokeObjectURL(blobUrl);
      if (audioCtx) try { audioCtx.close(); } catch(_) {}
      if (video.parentNode) video.parentNode.removeChild(video);
    };

    video.addEventListener('error', () => {
      cleanup(null);
      reject(new Error('Не удалось загрузить видео'));
    });

    video.addEventListener('canplaythrough', async () => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        const source = audioCtx.createMediaElementSource(video);
        const dest   = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        // source НЕ подключён к audioCtx.destination — пользователь не слышит

        const mimeType =
          MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
          MediaRecorder.isTypeSupported('audio/webm')             ? 'audio/webm'             :
          MediaRecorder.isTypeSupported('audio/mp4')              ? 'audio/mp4'              :
                                                                    'audio/ogg';

        const recorder = new MediaRecorder(dest.stream, { mimeType });
        const chunks   = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          cleanup(audioCtx);
          const ext     = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
          const audBlob = new Blob(chunks, { type: mimeType });
          resolve({ blobUrl: URL.createObjectURL(audBlob), ext });
        };
        recorder.onerror = () => {
          cleanup(audioCtx);
          reject(new Error('Ошибка записи аудио'));
        };

        recorder.start(100);
        video.volume = 0;
        await video.play();

        video.addEventListener('ended', () => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, { once: true });

      } catch(e) {
        cleanup(null);
        reject(e);
      }
    }, { once: true });

    video.load();
  });
}

async function fetchTikTokData(url) {
  const res  = await fetch(`${TIKWM_API}?url=${encodeURIComponent(url)}&hd=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) throw new Error(json.msg || 'Видео не найдено');

  return {
    title:      json.data.title  || '',
    author:     json.data.author?.unique_id || json.data.author?.nickname || '',
    cover:      json.data.cover  || '',
    video:      json.data.play   || json.data.wmplay || '',
    fullMusic:  json.data.music_info?.play || json.data.music || '',
    musicTitle: json.data.music_info?.title || json.data.music_info?.author || '',
  };
}

window.addEventListener('DOMContentLoaded', () => {

  const urlInput         = document.getElementById('urlInput');
  const pasteBtn         = document.getElementById('pasteBtn');
  const dlBtn            = document.getElementById('dlBtn');
  const btnText          = dlBtn.querySelector('.btn-text');
  const spinner          = document.getElementById('spinner');
  const errorMsg         = document.getElementById('errorMsg');
  const resultCard       = document.getElementById('resultCard');
  const thumbWrap        = document.getElementById('thumbWrap');
  const resultTitle      = document.getElementById('resultTitle');
  const resultAuthor     = document.getElementById('resultAuthor');
  const videoBtn         = document.getElementById('videoBtn');
  const audioBtn         = document.getElementById('audioBtn');
  const fullMusicBtn     = document.getElementById('fullMusicBtn');
  const videoBtnText     = document.getElementById('videoBtnText');
  const audioBtnText     = document.getElementById('audioBtnText');
  const fullMusicBtnText = document.getElementById('fullMusicBtnText');
  const videoSpinner     = document.getElementById('videoSpinner');
  const audioSpinner     = document.getElementById('audioSpinner');
  const fullMusicSpinner = document.getElementById('fullMusicSpinner');

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

    setActBtn(videoBtn,     videoBtnText,     videoSpinner,     { enabled: cache.hasVideo() });
    setActBtn(audioBtn,     audioBtnText,     audioSpinner,     { loading: true }); // идёт извлечение
    setActBtn(fullMusicBtn, fullMusicBtnText, fullMusicSpinner, { enabled: cache.hasFullMusic() });

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

      const [videoBlob, fullMusicBlob] = await Promise.all([
        data.video     ? urlToBlob(data.video)     : Promise.resolve(null),
        data.fullMusic ? urlToBlob(data.fullMusic) : Promise.resolve(null),
      ]);

      cache.set(videoBlob, null, fullMusicBlob, data.title, data.musicTitle);
      showResult(data);

      // Извлечение аудио из видео идёт в фоне (занимает столько же, сколько длится видео)
      if (data.video) {
        extractAudioFromVideo(data.video).then(({ blobUrl, ext }) => {
          cache.audioBlob = blobUrl;
          const safe = s => (s || '').slice(0, 60).replace(/[^\w\s-]/g, '');
          cache.audioName = (safe(data.title) || 'tiktok-audio') + '-audio.' + ext;
          setActBtn(audioBtn, audioBtnText, audioSpinner, { enabled: true });
        }).catch(() => {
          setActBtn(audioBtn, audioBtnText, audioSpinner, { enabled: false });
        });
      }

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

  fullMusicBtn.addEventListener('click', () => {
    if (cache.hasFullMusic()) triggerSave(cache.fullMusicBlob, cache.fullMusicName);
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
