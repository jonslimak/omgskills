(() => {
  const root = document.documentElement;
  const themeButton = document.getElementById('theme-toggle');
  const themePreference = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 759px)');
  const frame = document.getElementById('library-animation');
  let inView = false;
  let rotationTimer;
  let suggestionOffset = 0;

  const theme = () => root.dataset.theme || (themePreference.matches ? 'dark' : 'light');
  function syncAnimation() {
    frame.contentWindow?.postMessage({
      type: 'home-animation-state', theme: theme(),
      paused: !inView || document.hidden,
    }, location.origin);
  }
  function syncTheme() {
    const label = `Switch to ${theme() === 'dark' ? 'light' : 'dark'} mode`;
    themeButton.setAttribute('aria-label', label);
    themeButton.title = label;
    themeButton.querySelector('use').setAttribute('href', `/home/icons.svg#${theme() === 'dark' ? 'moon' : 'sun'}`);
    syncAnimation();
  }
  themeButton.hidden = false;
  // One theme key shared with the web app; links into the library carry the theme shown here,
  // including a system dark mode the visitor never toggled.
  const saveTheme = () => {
    try { localStorage.setItem('omgskills-theme', theme()); } catch { /* Theme still works for this visit. */ }
  };
  themeButton.addEventListener('click', () => {
    root.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
    saveTheme();
    syncTheme();
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('a[href^="/app"]')) saveTheme();
  }, true);
  document.addEventListener('submit', event => {
    if (event.target.getAttribute?.('action')?.startsWith('/app')) saveTheme();
  }, true);
  themePreference.addEventListener('change', syncTheme);
  syncTheme();
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncAnimation();
  }).observe(frame);
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'home-animation-ready') syncAnimation();
    if (event.data?.type === 'home-animation-size' && Number.isFinite(event.data.height)) {
      frame.style.height = `${Math.max(200, Math.min(900, event.data.height))}px`;
    }
  });
  frame.addEventListener('load', syncAnimation);

  const suggestions = document.querySelector('.suggestion-window');
  const originalLinks = [...suggestions.querySelectorAll('.suggestion-set:not([aria-hidden]) .skill-pill')];
  const mobileSuggestions = document.createElement('div');
  mobileSuggestions.className = 'mobile-suggestions';
  suggestions.append(mobileSuggestions);
  function showMobileSuggestions() {
    mobileSuggestions.replaceChildren(...Array.from({length: Math.min(4, originalLinks.length)}, (_, index) =>
      originalLinks[(suggestionOffset + index) % originalLinks.length].cloneNode(true)));
  }
  function scheduleRotation() {
    clearTimeout(rotationTimer);
    if (!mobile.matches || reducedMotion.matches || document.hidden ||
      suggestions.matches(':hover, :focus-within') || originalLinks.length <= 4) return;
    rotationTimer = setTimeout(() => {
      suggestionOffset = (suggestionOffset + 1) % originalLinks.length;
      showMobileSuggestions();
      mobileSuggestions.animate([{opacity: .5, transform: 'translateY(8px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 500});
      scheduleRotation();
    }, 2600);
  }
  function syncMotion() {
    root.dataset.motion = reducedMotion.matches || document.hidden ? 'paused' : 'running';
    syncAnimation();
    scheduleRotation();
  }
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', () => {
    // Reinitialize the illustration into its static reduced-motion frame when preferences change.
    frame.src = '/home/animation.html';
    syncMotion();
  });
  mobile.addEventListener('change', scheduleRotation);
  for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) suggestions.addEventListener(event, scheduleRotation);
  showMobileSuggestions();
  root.classList.add('suggestions-ready');
  syncMotion();

  document.querySelectorAll('[data-copy]').forEach(button => {
    let resetTimer;
    button.hidden = false;
    button.addEventListener('click', async () => {
      const status = document.getElementById('copy-status');
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        status.textContent = 'Copied to clipboard.';
        button.querySelector('use').setAttribute('href', '/home/icons.svg#check');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => button.querySelector('use').setAttribute('href', '/home/icons.svg#copy'), 1600);
      } catch {
        status.textContent = 'Could not copy. Select and copy the command shown above.';
      }
    });
  });
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains('avatar')) {
      event.target.style.visibility = 'hidden';
    }
  }, true);
})();

// Same download conversion events as the main landing page (X, Reddit, OpenAI ads).
document.querySelectorAll('a[href="/downloads/omgskills-mac.dmg"]').forEach(link => {
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setTimeout(() => { location.href = link.href; }, 150);
    // Each pixel is optional; failures must not interrupt the download or other pixels.
    try {
      if (typeof window.twq === 'function') window.twq('event', 'tw-qwhi7-rceh8', { value: null });
    } catch { /* Download is already scheduled. */ }
    try {
      if (typeof window.rdt === 'function') window.rdt('track', 'Custom', { customEventName: 'Download' });
    } catch { /* Download is already scheduled. */ }
    try {
      if (typeof window.oaiq === 'function') window.oaiq('measure', 'custom', { type: 'custom' }, { custom_event_name: 'download_clicked' });
    } catch { /* Download is already scheduled. */ }
  });
});
