'use strict';
// One navigation definition for every page. Versioned page URLs avoid stale headers.
(function renderSiteNavigation() {
  const version = '20261109-3';
  const items = [
    ['index.html', 'Home'], ['catalog.html', 'Card Catalog'],
    ['account.html', 'My Account'], ['events.html', 'Events'],
    ['programs.html', 'Programs'], ['research-help.html', 'Research Help'],
    ['community-support.html', 'Community Support'], ['stapleton-context.html', 'Stapleton Context'],
    ['about.html', 'About'],
    ['instructions.html', 'Instructions']
  ];
  const page = location.pathname.split('/').pop() || 'index.html';
  const current = page === 'account-summary.html' ? 'account.html' : page === 'catalog-detail.html' ? 'catalog.html' : page;
  for (const region of document.querySelectorAll('.topnav .nav-links')) {
    const links = items.map(([file, label]) => {
      const a = document.createElement('a');
      a.href = `${file}?nav=${version}`;
      a.textContent = label;
      if (file === current) a.setAttribute('aria-current', 'page');
      return a;
    });
    region.replaceChildren(...links);
  }
})();
