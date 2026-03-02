(function () {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const panel = document.querySelector('.mobile-menu-panel');

  if (!toggle || !panel) {
    return;
  }

  const navLinks = panel.querySelectorAll('a[href]');

  function setActiveLink() {
    let currentPage = window.location.pathname.split('/').pop();
    if (!currentPage) {
      currentPage = 'index.html';
    }

    navLinks.forEach((link) => {
      const href = (link.getAttribute('href') || '').split('#')[0];
      const isActive = href === currentPage;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function openMenu() {
    panel.hidden = false;
    toggle.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('mobile-menu-open');
  }

  function closeMenu() {
    panel.hidden = true;
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-menu-open');
  }

  function toggleMenu() {
    if (panel.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  }

  toggle.addEventListener('click', toggleMenu);

  navLinks.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (event) => {
    if (panel.hidden) {
      return;
    }

    const target = event.target;
    if (!panel.contains(target) && !toggle.contains(target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      closeMenu();
    }
  });

  const desktopMedia = window.matchMedia('(min-width: 781px)');
  function onMediaChange(event) {
    if (event.matches) {
      closeMenu();
    }
  }

  if (typeof desktopMedia.addEventListener === 'function') {
    desktopMedia.addEventListener('change', onMediaChange);
  } else if (typeof desktopMedia.addListener === 'function') {
    desktopMedia.addListener(onMediaChange);
  }

  setActiveLink();
  closeMenu();
})();
