const STORAGE_KEY = 'pomodoroSettings';
const defaultSettings = {
  pomodoro: 25,
  short: 5,
  long: 15,
  ambientSound: true,
  ambientType: 'lofi',
  ambientVolume: 40,
  finishSound: true,
};

const timerFace = document.getElementById('timerFace');
const modeButtons = document.querySelectorAll('.mode-btn');
const startButton = document.getElementById('startButton');
const resetButton = document.getElementById('resetButton');
const settingsButton = document.getElementById('settingsButton');
const settingsOverlay = document.getElementById('settingsOverlay');
const closeSettings = document.getElementById('closeSettings');
const saveSettings = document.getElementById('saveSettings');
const resetAll = document.getElementById('resetAll');
const pomodoroInput = document.getElementById('pomodoroInput');
const shortInput = document.getElementById('shortInput');
const longInput = document.getElementById('longInput');
const ambientToggle = document.getElementById('ambientToggle');
const ambientTypeSelect = document.getElementById('ambientType');
const ambientVolume = document.getElementById('ambientVolume');
const finishToggle = document.getElementById('finishToggle');
const displayCard = document.querySelector('.display-card');

let audioCtx = null;
let ambientSource = null;
let ambientGain = null;
let ambientNodes = [];
let currentMode = 'work';
let currentSeconds = 0;
let isRunning = false;
let intervalId = null;
let settings = loadSettings();

const modeConfig = {
  work: { seconds: settings.pomodoro * 60, label: 'pomodoro' },
  short: { seconds: settings.short * 60, label: 'short break' },
  long: { seconds: settings.long * 60, label: 'long break' },
};

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function createNoiseBuffer(ctx, durationSeconds = 2) {
  const length = ctx.sampleRate * durationSeconds;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 0.25;
  }
  return buffer;
}

function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettingsToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function formatTime(seconds) {
  const min = String(Math.floor(seconds / 60)).padStart(2, '0');
  const sec = String(seconds % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function updateDisplay() {
  timerFace.textContent = formatTime(currentSeconds);
}

function updateModeButtons() {
  modeButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.mode === currentMode);
  });
}

function applySettings() {
  modeConfig.work.seconds = settings.pomodoro * 60;
  modeConfig.short.seconds = settings.short * 60;
  modeConfig.long.seconds = settings.long * 60;
}

function openSettingsOverlay() {
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
  pomodoroInput.value = settings.pomodoro;
  shortInput.value = settings.short;
  longInput.value = settings.long;
  ambientToggle.checked = settings.ambientSound;
  ambientTypeSelect.value = settings.ambientType;
  ambientVolume.value = settings.ambientVolume;
  finishToggle.checked = settings.finishSound;
}

function closeSettingsOverlay() {
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

function setMode(mode) {
  currentMode = mode;
  currentSeconds = modeConfig[mode].seconds;
  updateDisplay();
  updateModeButtons();
  stopTimer();
}

function startAmbient() {
  if (!settings.ambientSound || currentMode !== 'work') return;
  stopAmbient();

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const masterGain = ctx.createGain();
  masterGain.gain.value = Math.max(0, Math.min(1, settings.ambientVolume / 100));
  masterGain.connect(ctx.destination);

  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = createNoiseBuffer(ctx, 4);
  noiseSource.loop = true;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 1200;
  lowpass.Q.value = 0.8;

  let extraNodes = [noiseSource, masterGain, lowpass];
  let voiceNodes = [];

  if (settings.ambientType === 'rain') {
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1400;
    bandpass.Q.value = 1.2;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(bandpass.frequency);

    noiseSource.connect(bandpass).connect(lowpass).connect(masterGain);
    lfo.start();
    voiceNodes.push(lfo, lfoGain, bandpass);
  } else if (settings.ambientType === 'bonfire') {
    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'lowpass';
    fireFilter.frequency.value = 900;
    fireFilter.Q.value = 1;

    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.8;
    const tremoloLFO = ctx.createOscillator();
    tremoloLFO.type = 'triangle';
    tremoloLFO.frequency.value = 1.5;
    tremoloLFO.connect(tremolo.gain);

    noiseSource.connect(fireFilter).connect(tremolo).connect(masterGain);
    tremoloLFO.start();
    voiceNodes.push(fireFilter, tremolo, tremoloLFO);
  } else if (settings.ambientType === 'lofi-beats') {
    const beatFilter = ctx.createBiquadFilter();
    beatFilter.type = 'lowpass';
    beatFilter.frequency.value = 1000;
    beatFilter.Q.value = 1;

    const chordGain = ctx.createGain();
    chordGain.gain.value = 0.05;

    const baseOsc1 = ctx.createOscillator();
    baseOsc1.type = 'triangle';
    baseOsc1.frequency.value = 110;
    const baseOsc2 = ctx.createOscillator();
    baseOsc2.type = 'triangle';
    baseOsc2.frequency.value = 138.59;

    baseOsc1.connect(chordGain);
    baseOsc2.connect(chordGain);
    chordGain.connect(beatFilter).connect(masterGain);

    const beatLFO = ctx.createOscillator();
    beatLFO.type = 'sine';
    beatLFO.frequency.value = 2.4;
    const beatGain = ctx.createGain();
    beatGain.gain.value = 0.3;
    beatLFO.connect(beatGain.gain);
    beatGain.connect(masterGain.gain);

    baseOsc1.start();
    baseOsc2.start();
    beatLFO.start();
    noiseSource.connect(lowpass).connect(masterGain);
    voiceNodes.push(beatFilter, chordGain, baseOsc1, baseOsc2, beatLFO, beatGain);
  } else {
    const lofiFilter = ctx.createBiquadFilter();
    lofiFilter.type = 'lowpass';
    lofiFilter.frequency.value = 1100;
    lofiFilter.Q.value = 0.85;

    const chordGain = ctx.createGain();
    chordGain.gain.value = 0.05;
    const pad1 = ctx.createOscillator();
    pad1.type = 'triangle';
    pad1.frequency.value = 110;
    const pad2 = ctx.createOscillator();
    pad2.type = 'triangle';
    pad2.frequency.value = 146.83;

    pad1.connect(chordGain);
    pad2.connect(chordGain);
    chordGain.connect(lofiFilter).connect(masterGain);

    pad1.start();
    pad2.start();
    voiceNodes.push(lofiFilter, chordGain, pad1, pad2);
    noiseSource.connect(lowpass).connect(masterGain);
  }

  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      noiseSource.start();
    }).catch(() => {
      noiseSource.start();
    });
  } else {
    noiseSource.start();
  }

  ambientSource = noiseSource;
  ambientGain = masterGain;
  ambientNodes = [noiseSource, masterGain, lowpass, ...voiceNodes];
}

function stopAmbient() {
  if (!ambientNodes || ambientNodes.length === 0) return;
  ambientNodes.forEach(node => {
    if (!node) return;
    try {
      if (typeof node.stop === 'function') node.stop();
    } catch {}
    try {
      if (typeof node.disconnect === 'function') node.disconnect();
    } catch {}
  });
  ambientNodes = [];
  ambientSource = null;
  ambientGain = null;
}

function playFinishSound() {
  if (!settings.finishSound) return;
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.65, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

  const tone = ctx.createOscillator();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(520, now);

  const tone2 = ctx.createOscillator();
  tone2.type = 'sine';
  tone2.frequency.setValueAtTime(880, now);
  tone2.detune.setValueAtTime(20, now);

  tone.connect(gain);
  tone2.connect(gain);
  gain.connect(ctx.destination);

  tone.start(now);
  tone2.start(now);
  tone.stop(now + 1.4);
  tone2.stop(now + 1.4);
}

function playSubtleBeep() {
  if (!settings.finishSound) return;
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

  const tone = ctx.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(520, now);
  tone.connect(gain);
  gain.connect(ctx.destination);

  tone.start(now);
  tone.stop(now + 0.7);
}

function startTimer() {
  if (intervalId) return;
  intervalId = setInterval(tick, 1000);
  isRunning = true;
  startButton.textContent = 'pause';
  displayCard.classList.remove('paused');
  if (currentMode === 'work') startAmbient();
}

function stopTimer() {
  clearInterval(intervalId);
  intervalId = null;
  isRunning = false;
  startButton.textContent = 'start';
  displayCard.classList.add('paused');
  stopAmbient();
}

function toggleTimer() {
  if (isRunning) {
    stopTimer();
  } else {
    startTimer();
  }
}

function resetTimer() {
  currentSeconds = modeConfig[currentMode].seconds;
  updateDisplay();
  stopTimer();
}

function tick() {
  if (currentSeconds > 0) {
    currentSeconds -= 1;
    updateDisplay();
  } else {
    if (currentMode === 'work') {
      workSessionCount += 1;
      playFinishSound();
      transitionToBreak();
    } else {
      playSubtleBeep();
      transitionToWork();
    }
  }
}

function transitionToBreak() {
  const nextMode = workSessionCount % 4 === 0 ? 'long' : 'short';
  currentMode = nextMode;
  currentSeconds = modeConfig[nextMode].seconds;
  updateModeButtons();
  updateDisplay();
  stopAmbient();
  startTimer();
}

function transitionToWork() {
  currentMode = 'work';
  currentSeconds = modeConfig.work.seconds;
  updateModeButtons();
  updateDisplay();
  startTimer();
}

function saveSettingsHandler() {
  const pomodoroValue = Number(pomodoroInput.value) || defaultSettings.pomodoro;
  const shortValue = Number(shortInput.value) || defaultSettings.short;
  const longValue = Number(longInput.value) || defaultSettings.long;

  settings.pomodoro = Math.max(1, Math.min(180, pomodoroValue));
  settings.short = Math.max(1, Math.min(60, shortValue));
  settings.long = Math.max(1, Math.min(120, longValue));
  settings.ambientSound = ambientToggle.checked;
  settings.ambientType = ambientTypeSelect.value;
  settings.ambientVolume = Math.max(0, Math.min(100, Number(ambientVolume.value) || defaultSettings.ambientVolume));
  settings.finishSound = finishToggle.checked;

  applySettings();
  saveSettingsToStorage();
  setMode(currentMode);
  closeSettingsOverlay();
}

function resetAllSettingsHandler() {
  settings = { ...defaultSettings };
  saveSettingsToStorage();
  applySettings();
  openSettingsOverlay();
  pomodoroInput.value = settings.pomodoro;
  shortInput.value = settings.short;
  longInput.value = settings.long;
  ambientToggle.checked = settings.ambientSound;
  finishToggle.checked = settings.finishSound;
  setMode(currentMode);
}

modeButtons.forEach(button => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

startButton.addEventListener('click', event => {
  event.stopPropagation();
  toggleTimer();
});

resetButton.addEventListener('click', event => {
  event.stopPropagation();
  resetTimer();
});

settingsButton.addEventListener('click', event => {
  event.stopPropagation();
  openSettingsOverlay();
});

closeSettings.addEventListener('click', event => {
  event.stopPropagation();
  closeSettingsOverlay();
});

saveSettings.addEventListener('click', event => {
  event.stopPropagation();
  saveSettingsHandler();
});

resetAll.addEventListener('click', event => {
  event.stopPropagation();
  resetAllSettingsHandler();
});

displayCard.addEventListener('click', event => {
  if (event.target.closest('.icon-btn')) return;
  toggleTimer();
});

applySettings();
setMode(currentMode);
closeSettingsOverlay();

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('data:application/javascript,self.addEventListener("install",e=>e.waitUntil(caches.open("pomodoro-v1").then(c=>c.addAll(["/","/index.html","/styles.css","/script.js"]))));self.addEventListener("fetch",e=>{if(e.request.method==="GET"){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))}});', {
    scope: '/'
  }).catch(() => {});
}

// Device Orientation Handler - Enhanced
function handleOrientationChange() {
  const isPortrait = window.innerHeight > window.innerWidth;
  const orientation = isPortrait ? 'portrait' : 'landscape';
  document.documentElement.setAttribute('data-orientation', orientation);
  document.body.style.width = '100vw';
  document.body.style.height = '100vh';
}

// Prevent zoom and auto-hide address bar
function preventZoom(e) {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}

document.addEventListener('touchmove', preventZoom, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());

// Listen for orientation changes
window.addEventListener('orientationchange', handleOrientationChange);
window.addEventListener('resize', handleOrientationChange);
window.addEventListener('load', handleOrientationChange);
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    window.scrollTo(0, 0);
    handleOrientationChange();
  }, 100);
});

// Screen Orientation API - Allow both portrait and landscape
if (screen.orientation && screen.orientation.lock) {
  Promise.all([
    screen.orientation.lock('portrait-primary').catch(() => {}),
    screen.orientation.lock('landscape-primary').catch(() => {})
  ]).catch(() => {});
  
  screen.orientation.addEventListener('change', handleOrientationChange);
}

// Request fullscreen and handle orientation
function enableFullscreen() {
  const elem = document.documentElement;
  if (elem.requestFullscreen) {
    elem.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } else if (elem.webkitRequestFullscreen) {
    elem.webkitRequestFullscreen();
  } else if (elem.mozRequestFullScreen) {
    elem.mozRequestFullScreen();
  } else if (elem.msRequestFullscreen) {
    elem.msRequestFullscreen();
  }
}

// Try fullscreen on first touch
let fullscreenRequested = false;
document.addEventListener('touchstart', () => {
  if (!fullscreenRequested && window.innerHeight <= 768) {
    enableFullscreen();
    fullscreenRequested = true;
  }
}, { once: false, passive: true });

// Handle visibility change to re-request fullscreen
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !document.fullscreenElement) {
    setTimeout(enableFullscreen, 500);
  }
});

handleOrientationChange();

