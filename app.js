(() => {
  "use strict";

  const VALID_CODE = "NL-JUNIOR-SCIENTIST-006";
  const RESULT_DURATION_MS = 3600;
  const REPEAT_BLOCK_MS = 8000;

  const screens = {
    start: document.getElementById("start-screen"),
    scanner: document.getElementById("scanner-screen"),
    granted: document.getElementById("granted-screen"),
    denied: document.getElementById("denied-screen"),
    error: document.getElementById("error-screen")
  };

  const startButton = document.getElementById("start-button");
  const retryButton = document.getElementById("retry-button");
  const manualTestButton = document.getElementById("manual-test-button");
  const video = document.getElementById("camera-video");
  const cameraMessage = document.getElementById("camera-message");
  const wakePill = document.getElementById("wake-pill");
  const cameraPill = document.getElementById("camera-pill");
  const errorText = document.getElementById("error-text");
  const adminDialog = document.getElementById("admin-dialog");

  let stream = null;
  let detector = null;
  let scanTimer = null;
  let wakeLock = null;
  let scanning = false;
  let resultShowing = false;
  let lastCode = "";
  let lastCodeAt = 0;
  let audioContext = null;
  let secretTapCount = 0;
  let secretTapTimer = null;

  function showScreen(name) {
    Object.values(screens).forEach((screen) => screen.classList.remove("active"));
    screens[name].classList.add("active");
  }

  async function requestFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
      if (screen.orientation?.lock) {
        try { await screen.orientation.lock("portrait"); } catch (_) {}
      }
    } catch (_) {
      // Fullscreen is helpful, but scanning should still work without it.
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      wakePill.classList.add("off");
      wakePill.innerHTML = "<i></i> WAKE LOCK UNAVAILABLE";
      return;
    }

    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakePill.classList.remove("off");
      wakePill.innerHTML = "<i></i> SCREEN AWAKE";
      wakeLock.addEventListener("release", () => {
        if (!document.hidden && scanning) requestWakeLock();
      });
    } catch (_) {
      wakePill.classList.add("off");
      wakePill.innerHTML = "<i></i> TAP TO RE-AWAKE";
    }
  }

  async function stopCamera() {
    scanning = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  async function startScanner() {
    await stopCamera();
    showScreen("scanner");
    cameraMessage.textContent = "Starting secure front camera…";
    cameraPill.classList.remove("off");
    cameraPill.innerHTML = "<i></i> FRONT CAMERA";

    await requestFullscreen();
    await requestWakeLock();
    initializeAudio();

    if (!("BarcodeDetector" in window)) {
      showError("This browser does not include the QR scanner required by this app. Open the app in Chrome on an Android phone, then try again.");
      return;
    }

    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      if (!supported.includes("qr_code")) {
        showError("This browser can access the camera but does not support QR-code detection. Open the app in Chrome on an Android phone.");
        return;
      }
      detector = new BarcodeDetector({ formats: ["qr_code"] });

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
          frameRate: { ideal: 30, max: 30 }
        }
      });

      video.srcObject = stream;
      await video.play();
      scanning = true;
      cameraMessage.textContent = "Front camera active — present an ID card";
      scanLoop();
    } catch (error) {
      const message = cameraErrorMessage(error);
      showError(message);
    }
  }

  function cameraErrorMessage(error) {
    if (!error) return "The front camera could not be started.";
    if (error.name === "NotAllowedError") return "Camera access was not allowed. Open the browser settings for this page, allow the camera, and tap Retry Scanner.";
    if (error.name === "NotFoundError") return "No front-facing camera was found on this device.";
    if (error.name === "NotReadableError") return "The camera is being used by another app. Close other camera apps, then tap Retry Scanner.";
    if (location.protocol !== "https:" && location.hostname !== "localhost") return "Camera access requires the app to be opened from a secure HTTPS web address.";
    return `The front camera could not be started (${error.name || "unknown error"}).`;
  }

  function showError(message) {
    stopCamera();
    errorText.textContent = message;
    showScreen("error");
  }

  async function scanLoop() {
    if (!scanning) return;

    if (!resultShowing && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          const rawValue = String(barcodes[0].rawValue || "").trim();
          handleCode(rawValue);
        }
      } catch (_) {
        // Some frames are unreadable while the camera is focusing; keep scanning.
      }
    }

    scanTimer = setTimeout(scanLoop, 180);
  }

  function handleCode(code) {
    if (!code || resultShowing) return;
    const now = Date.now();
    if (code === lastCode && now - lastCodeAt < REPEAT_BLOCK_MS) return;

    lastCode = code;
    lastCodeAt = now;

    if (code === VALID_CODE) {
      showResult("granted");
      playGrantedSound();
      vibrate([70, 50, 120]);
    } else {
      showResult("denied");
      playDeniedSound();
      vibrate([150]);
    }
  }

  function showResult(type) {
    resultShowing = true;
    showScreen(type);
    window.setTimeout(() => {
      resultShowing = false;
      if (stream && scanning) {
        showScreen("scanner");
      } else {
        startScanner();
      }
    }, RESULT_DURATION_MS);
  }

  function initializeAudio() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
    } catch (_) {}
  }

  function tone(frequency, start, duration, gainValue = 0.12, type = "sine") {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playGrantedSound() {
    if (!audioContext) return;
    const t = audioContext.currentTime;
    tone(523.25, t, 0.16, 0.1, "sine");
    tone(659.25, t + 0.12, 0.18, 0.11, "sine");
    tone(783.99, t + 0.26, 0.28, 0.12, "sine");
  }

  function playDeniedSound() {
    if (!audioContext) return;
    const t = audioContext.currentTime;
    tone(190, t, 0.22, 0.1, "square");
    tone(145, t + 0.18, 0.3, 0.09, "square");
  }

  function vibrate(pattern) {
    try { navigator.vibrate?.(pattern); } catch (_) {}
  }

  function handleSecretTap() {
    secretTapCount += 1;
    clearTimeout(secretTapTimer);
    secretTapTimer = setTimeout(() => { secretTapCount = 0; }, 2500);
    if (secretTapCount >= 5) {
      secretTapCount = 0;
      adminDialog.showModal();
    }
  }

  startButton.addEventListener("click", startScanner);
  retryButton.addEventListener("click", startScanner);
  manualTestButton.addEventListener("click", () => showResult("granted"));
  document.getElementById("secret-admin-trigger").addEventListener("click", handleSecretTap);
  document.getElementById("scanner-admin-trigger").addEventListener("click", handleSecretTap);

  document.getElementById("admin-test-granted").addEventListener("click", () => {
    adminDialog.close();
    showResult("granted");
    playGrantedSound();
  });
  document.getElementById("admin-test-denied").addEventListener("click", () => {
    adminDialog.close();
    showResult("denied");
    playDeniedSound();
  });
  document.getElementById("admin-restart-camera").addEventListener("click", () => {
    adminDialog.close();
    startScanner();
  });
  document.getElementById("admin-fullscreen").addEventListener("click", requestFullscreen);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && scanning) requestWakeLock();
  });

  window.addEventListener("beforeunload", stopCamera);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
