// Verso's site: the theme toggle, phone videos that match the page's theme, and loops that
// play only while on screen (and never on their own under reduced motion).
(() => {
  const root = document.documentElement;
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const theme = () => root.dataset.theme || (dark.matches ? 'dark' : 'light');
  const videos = [...document.querySelectorAll('video[data-light]')];
  const play = (v) => { if (v.dataset.visible === '1' && !still.matches) v.play().catch(() => {}); };

  const match = () => videos.forEach((v) => {
    const src = v.dataset[theme()];
    if (v.getAttribute('src') === src) return;
    v.poster = src.replace(/\.mp4$/, '.jpg');
    v.src = src;
    play(v);
  });
  match();
  dark.addEventListener('change', match);
  new MutationObserver(match).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  const seen = new IntersectionObserver((entries) => entries.forEach(({ target: v, isIntersecting }) => {
    v.dataset.visible = isIntersecting ? '1' : '0';
    if (isIntersecting) play(v); else v.pause();
  }), { threshold: 0.3 });
  videos.forEach((v) => seen.observe(v));

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
      try { localStorage.setItem('verso-theme', next); } catch (e) { /* private mode: the choice lasts this visit */ }
    };
    if (document.startViewTransition && !still.matches) document.startViewTransition(apply); else apply();
  }));
})();
