// Signed in (Clerk's __client_uat is above 0, as on the home page): the omgskills logo opens My skills
// instead of the home page. Signed out, it stays a link home.
(function () {
  try {
    if (!/(?:^|;\s*)__client_uat(?:_[^=;]*)?=[1-9][0-9]*(?:;|$)/.test(document.cookie)) return;
    var logos = document.querySelectorAll('a.brand[href="/"], a.eyes[href="/"], a.site-footer-brand-logo[href="/"]');
    for (var i = 0; i < logos.length; i += 1) logos[i].setAttribute("href", "/app/?view=all");
  } catch (error) {}
})();
