(() => {
  try {
    // Shared with the web app (/app/), so the library opens in the same theme.
    const theme = localStorage.getItem('omgskills-theme') || localStorage.getItem('omgskills-home-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* System theme remains available when storage is blocked. */ }
})();
