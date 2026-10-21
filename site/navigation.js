// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

(() => {
  const nav = document.querySelector('nav.top');
  const toggle = nav?.querySelector('.menu-toggle');
  const links = nav?.querySelector('.links');
  if (!toggle || !links) return;

  const closeMenu = (restoreFocus = false) => {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    links.classList.remove('is-open');
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeMenu();
    } else {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close navigation');
      links.classList.add('is-open');
    }
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      closeMenu(true);
    }
  });
  window.matchMedia('(min-width: 721px)').addEventListener('change', (event) => {
    if (event.matches) closeMenu();
  });

  document.documentElement.classList.add('nav-ready');
})();
