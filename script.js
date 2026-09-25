/* =========================================================
   AXIOO promotional page — vanilla JS + GSAP/ScrollTrigger
   Semua path frame WAJIB lewat getFramePath() + CONFIG.
   ========================================================= */

const CONFIG = {
  framePath: "frames/",
  filePrefix: "frame_",
  fileExtension: ".jpg",
  totalFrames: 100,
  startIndex: 1,
  padLength: 4,
};

/** Menyusun path file dari CONFIG. Contoh: frames/frame_0001.jpg */
function getFramePath(index) {
  const padded = String(index).padStart(CONFIG.padLength, "0");
  return `${CONFIG.framePath}${CONFIG.filePrefix}${padded}${CONFIG.fileExtension}`;
}

/* ----- State ----- */
const frames = new Array(CONFIG.totalFrames);
let framesReady = false;
let heroComplete = false;
let isLocked = true;
let currentFrame = 0;
let sequenceCtx = null;
let heroFallbackCtx = null;
let fallbackRaf = 0;

const HERO_FALLBACK_MS = 4000; // ±4 detik, selaras durasi video

const els = {
  html: document.documentElement,
  body: document.body,
  navbar: document.getElementById("navbar"),
  navToggle: document.getElementById("nav-toggle"),
  navMenu: document.getElementById("nav-menu"),
  video: document.getElementById("hero-video"),
  skip: document.getElementById("hero-skip"),
  hint: document.getElementById("scroll-hint"),
  preloadUi: document.getElementById("preload-ui"),
  preloadBar: document.getElementById("preload-bar"),
  preloadPct: document.getElementById("preload-pct"),
  sequence: document.getElementById("sequence"),
  canvas: document.getElementById("sequence-canvas"),
  heroFallback: document.getElementById("hero-fallback"),
  seqTitle: document.getElementById("sequence-title"),
  seqSub: document.getElementById("sequence-sub"),
  gallery: document.getElementById("gallery-stage"),
  year: document.getElementById("year"),
};

/* =========================================================
   BOOT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  if (els.year) els.year.textContent = String(new Date().getFullYear());

  setupCanvasContexts();
  setupNavbar();
  buildGallery();
  setupRevealObserver();
  setupHero();
  setupSequenceScrub();
  setupParallax();

  // Preload frame di background SELAMA hero video masih diputar
  preloadFrames();
});

/* =========================================================
   HERO VIDEO — lock scroll, play once, skip / early-scroll
   ========================================================= */
function setupHero() {
  lockScroll(true);

  const video = els.video;

  video.addEventListener("ended", () => finishHero("ended"));
  video.addEventListener("error", () => startHeroFallback());

  // Beberapa browser menunda autoplay; coba play manual
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Autoplay diblokir atau file hilang → fallback sequence
      if (video.readyState < 2) startHeroFallback();
    });
  }

  // Jika metadata tidak datang (file tidak ada), fallback
  window.setTimeout(() => {
    if (!heroComplete && video.readyState === 0) startHeroFallback();
  }, 1800);

  els.skip.addEventListener("click", () => finishHero("skip"));

  // Scroll manual sebelum video selesai: video tetap main, scroll dibuka
  window.addEventListener(
    "wheel",
    (event) => {
      if (!isLocked || heroComplete) return;
      event.preventDefault();
      finishHero("early-scroll");
      window.scrollBy({ top: Math.max(event.deltaY, 90), behavior: "smooth" });
    },
    { passive: false }
  );

  let touchStartY = 0;
  window.addEventListener(
    "touchstart",
    (event) => {
      if (!isLocked) return;
      touchStartY = event.touches[0].clientY;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (!isLocked || heroComplete) return;
      const dy = touchStartY - event.touches[0].clientY;
      if (dy > 24) {
        event.preventDefault();
        finishHero("early-scroll");
      }
    },
    { passive: false }
  );

  window.addEventListener("keydown", (event) => {
    if (!isLocked || heroComplete) return;
    const keys = ["ArrowDown", "PageDown", " ", "Spacebar"];
    if (keys.includes(event.key)) {
      event.preventDefault();
      finishHero("early-scroll");
    }
  });
}

function lockScroll(locked) {
  isLocked = locked;
  els.body.classList.toggle("is-locked", locked);
  els.html.classList.toggle("is-locked", locked);
}

/**
 * @param {"ended"|"skip"|"early-scroll"} reason
 * Skip / early-scroll membiarkan video terus main di background.
 */
function finishHero(reason) {
  if (heroComplete && reason !== "ended") return;
  if (heroComplete && reason === "ended") {
    // Video selesai setelah user sudah skip — cukup hide skip
    els.skip.hidden = true;
    return;
  }

  heroComplete = true;
  lockScroll(false);
  cancelAnimationFrame(fallbackRaf);

  revealNavbar();
  els.hint.hidden = false;
  els.skip.hidden = reason === "ended";

  if (reason === "skip") {
    try {
      els.video.pause();
    } catch (_) {
      /* ignore */
    }
    window.scrollTo({ top: els.sequence.offsetTop, behavior: "smooth" });
  }
}

function revealNavbar() {
  els.navbar.classList.add("is-visible");
  els.navbar.setAttribute("aria-hidden", "false");

  if (window.gsap) {
    window.gsap.fromTo(
      els.navbar,
      { y: -20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, ease: "power3.out", overwrite: true }
    );
  }
}

/** Fallback: putar 100 frame sebagai "video" 4 detik, satu kali, fullscreen cover */
function startHeroFallback() {
  if (els.video.dataset.fallback === "1") return;
  els.video.dataset.fallback = "1";
  els.video.style.opacity = "0";
  els.heroFallback.style.zIndex = "1";

  const startWhenReady = () => {
    resizeHeroFallback();
    const startedAt = performance.now();

    const tick = (now) => {
      if (heroComplete) return;
      const t = Math.min(1, (now - startedAt) / HERO_FALLBACK_MS);
      const index = Math.round(t * (CONFIG.totalFrames - 1));
      drawCover(heroFallbackCtx, frames[index], els.heroFallback);
      if (t < 1) {
        fallbackRaf = requestAnimationFrame(tick);
      } else {
        finishHero("ended");
      }
    };

    fallbackRaf = requestAnimationFrame(tick);
  };

  if (frames[0] && frames[0].complete && frames[0].naturalWidth) {
    startWhenReady();
  } else {
    // Tunggu frame pertama (preload sudah jalan)
    const wait = window.setInterval(() => {
      if (frames[0] && frames[0].naturalWidth) {
        window.clearInterval(wait);
        startWhenReady();
      }
    }, 50);
    window.setTimeout(() => window.clearInterval(wait), 8000);
  }
}

function resizeHeroFallback() {
  const canvas = els.heroFallback;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { clientWidth: w, clientHeight: h } = canvas;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  if (heroFallbackCtx) heroFallbackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* =========================================================
   FRAME PRELOAD
   ========================================================= */
function preloadFrames() {
  let loaded = 0;
  const total = CONFIG.totalFrames;

  for (let i = 0; i < total; i += 1) {
    const fileIndex = CONFIG.startIndex + i;
    const img = new Image();
    img.decoding = "async";
    img.src = getFramePath(fileIndex);
    const onDone = () => {
      loaded += 1;
      const pct = Math.round((loaded / total) * 100);
      els.preloadBar.style.width = `${pct}%`;
      els.preloadPct.textContent = `${pct}%`;
      if (i === 0) drawSequenceFrame(0);
      if (loaded === total) {
        framesReady = true;
        els.preloadUi.classList.add("is-done");
        drawSequenceFrame(currentFrame);
      }
    };
    img.addEventListener("load", onDone);
    img.addEventListener("error", onDone);
    frames[i] = img;
  }
}

/* =========================================================
   CANVAS SEQUENCE — cover draw + scroll scrub
   ========================================================= */
function setupCanvasContexts() {
  sequenceCtx = els.canvas.getContext("2d", { alpha: false });
  heroFallbackCtx = els.heroFallback.getContext("2d", { alpha: false });
  resizeSequenceCanvas();
  resizeHeroFallback();

  window.addEventListener("resize", () => {
    resizeSequenceCanvas();
    resizeHeroFallback();
    drawSequenceFrame(currentFrame);
  });
}

function resizeSequenceCanvas() {
  const canvas = els.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  sequenceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Mode cover: isi penuh tanpa distorsi, crop tengah jika rasio beda */
function drawCover(ctx, img, canvas) {
  if (!ctx || !img || !img.naturalWidth) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, dx, dy, dw, dh);
}

function setupSequenceScrub() {
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const progress = getSequenceProgress();
      const frameIndex = Math.round(progress * (CONFIG.totalFrames - 1));
      if (frameIndex !== currentFrame) {
        currentFrame = frameIndex;
        drawSequenceFrame(frameIndex);
        updateSequenceCopy(progress);
      }
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function getSequenceProgress() {
  const section = els.sequence;
  const rect = section.getBoundingClientRect();
  const scrollable = section.offsetHeight - window.innerHeight;
  if (scrollable <= 0) return 0;
  const scrolled = -rect.top;
  return Math.min(1, Math.max(0, scrolled / scrollable));
}

function drawSequenceFrame(frameIndex) {
  const img = frames[frameIndex];
  drawCover(sequenceCtx, img, els.canvas);
}

function updateSequenceCopy(progress) {
  if (!els.seqTitle) return;
  if (progress < 0.33) {
    els.seqTitle.textContent = "Born from light.";
    els.seqSub.textContent = "Ruang gelap. Emas cair mulai hidup.";
  } else if (progress < 0.7) {
    els.seqTitle.textContent = "Liquid metal. Pure intent.";
    els.seqSub.textContent = "Ribbon keemasan membentuk siluet AXIOO.";
  } else {
    els.seqTitle.textContent = "AXIOO. Revealed.";
    els.seqSub.textContent = "Layar hidup. Jejak cahaya biru. Siap berkarya.";
  }
}

/* =========================================================
   NAV
   ========================================================= */
function setupNavbar() {
  els.navToggle.addEventListener("click", () => {
    const open = els.navbar.classList.toggle("is-open");
    els.navToggle.setAttribute("aria-expanded", String(open));
  });

  els.navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => {
      els.navbar.classList.remove("is-open");
      if (isLocked) {
        event.preventDefault();
        finishHero("skip");
      }
    });
  });
}

/* =========================================================
   GALLERY — path hanya via getFramePath()
   ========================================================= */
function buildGallery() {
  const picks = [
    { index: CONFIG.startIndex + 49, caption: "Forming" },
    { index: CONFIG.startIndex + 68, caption: "Orbit" },
    { index: CONFIG.startIndex + 84, caption: "Splash" },
    { index: CONFIG.startIndex + 99, caption: "Open" },
  ];

  picks.forEach((item) => {
    const figure = document.createElement("figure");
    figure.className = "gallery__item";
    const img = document.createElement("img");
    img.src = getFramePath(item.index);
    img.alt = `AXIOO laptop — ${item.caption}`;
    const cap = document.createElement("figcaption");
    cap.className = "gallery__caption";
    cap.textContent = item.caption;
    figure.append(img, cap);
    els.gallery.append(figure);
  });
}

/* =========================================================
   SPECS fade-up — IntersectionObserver
   ========================================================= */
function setupRevealObserver() {
  const nodes = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );
  nodes.forEach((node) => observer.observe(node));
}

/* =========================================================
   Gallery parallax ringan (GSAP ScrollTrigger)
   ========================================================= */
function setupParallax() {
  if (!window.gsap || !window.ScrollTrigger) return;
  window.gsap.registerPlugin(window.ScrollTrigger);

  window.gsap.utils.toArray(".gallery__item img").forEach((img, i) => {
    window.gsap.fromTo(
      img,
      { yPercent: i % 2 === 0 ? -6 : 6 },
      {
        yPercent: i % 2 === 0 ? 6 : -6,
        ease: "none",
        scrollTrigger: {
          trigger: img.parentElement,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      }
    );
  });
}
