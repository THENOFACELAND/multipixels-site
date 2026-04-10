(function setupSiteShell() {
  const body = document.body;
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.mobile-menu-toggle');
  const mobilePanel = document.getElementById('mobile-menu-panel');
  const navLinks = document.querySelectorAll('[data-nav-link]');
  const revealNodes = document.querySelectorAll('.reveal');
  const cartCountNodes = document.querySelectorAll('[data-cart-count]');
  const headerActions = document.querySelector('.header-actions');
  const mobileNavPanel = mobilePanel ? mobilePanel.querySelector('.mobile-nav-panel') : null;

  function getCart() {
    try {
      const raw = window.localStorage.getItem('multipixels_cart');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function getClientToken() {
    try {
      return window.localStorage.getItem('multipixels_client_token') || '';
    } catch (_) {
      return '';
    }
  }

  function getCartCount() {
    return getCart().reduce(function (sum, item) {
      return sum + Math.max(0, Number(item.quantity || 0));
    }, 0);
  }

  function updateCartCount() {
    const count = getCartCount();
    cartCountNodes.forEach(function (node) {
      node.textContent = String(count);
      node.hidden = count === 0;
    });
  }

  function setActiveNav() {
    const current = window.location.pathname.split('/').pop() || 'index.html';
    navLinks.forEach(function (link) {
      const href = (link.getAttribute('href') || '').split('#')[0] || 'index.html';
      const active = href === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function ensureClientEntry() {
    const hasToken = Boolean(getClientToken());
    const href = hasToken ? 'mon-compte.html' : 'espace-client.html';
    const label = hasToken ? 'Mon compte' : 'Espace client';
    const iconMarkup = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12.2a4.1 4.1 0 1 0-4.1-4.1 4.1 4.1 0 0 0 4.1 4.1Zm0 2.2c-4.05 0-7.3 2.08-7.3 4.65 0 .36.29.65.65.65h13.3c.36 0 .65-.29.65-.65 0-2.57-3.25-4.65-7.3-4.65Z"></path></svg>';

    if (headerActions) {
      let desktopEntry = headerActions.querySelector('[data-client-entry]');
      if (!desktopEntry) {
        desktopEntry = document.createElement('a');
        desktopEntry.className = 'header-account';
        desktopEntry.setAttribute('data-client-entry', 'desktop');
        headerActions.insertBefore(desktopEntry, toggle || null);
      }
      desktopEntry.href = href;
      desktopEntry.innerHTML = iconMarkup + '<span>' + label + '</span>';
    }

    if (mobileNavPanel) {
      let mobileEntry = mobileNavPanel.querySelector('[data-client-entry-mobile]');
      if (!mobileEntry) {
        mobileEntry = document.createElement('a');
        mobileEntry.className = 'mobile-client-entry';
        mobileEntry.setAttribute('data-client-entry-mobile', 'true');
        mobileNavPanel.appendChild(mobileEntry);
      }
      mobileEntry.href = href;
      mobileEntry.innerHTML = iconMarkup + '<span>' + label + '</span>';
    }
  }

  function closeMenu() {
    if (!toggle || !mobilePanel) return;
    mobilePanel.hidden = true;
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    body.classList.remove('mobile-menu-open');
  }

  function openMenu() {
    if (!toggle || !mobilePanel) return;
    mobilePanel.hidden = false;
    toggle.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    body.classList.add('mobile-menu-open');
  }

  if (toggle && mobilePanel) {
    closeMenu();
    toggle.addEventListener('click', function () {
      if (mobilePanel.hidden) openMenu();
      else closeMenu();
    });
    mobilePanel.querySelectorAll('a[href]').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });

    const desktopMedia = window.matchMedia('(min-width: 921px)');
    const syncMenuState = function (event) {
      if (event.matches) closeMenu();
    };

    if (typeof desktopMedia.addEventListener === 'function') {
      desktopMedia.addEventListener('change', syncMenuState);
    } else if (typeof desktopMedia.addListener === 'function') {
      desktopMedia.addListener(syncMenuState);
    }
  }

  document.addEventListener('click', function (event) {
    if (!toggle || !mobilePanel || mobilePanel.hidden) return;
    if (mobilePanel.contains(event.target) || toggle.contains(event.target)) return;
    closeMenu();
  });

  if (header) {
    const onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 16);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  if (revealNodes.length) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealNodes.forEach(function (node) {
      const nodeHeight = node.offsetHeight || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      if (viewportHeight && nodeHeight > viewportHeight * 1.1) {
        node.classList.add('is-visible');
        return;
      }
      observer.observe(node);
    });
  }

  function applyContactPrefill() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    const params = new URLSearchParams(window.location.search);
    const service = params.get('service');
    const product = params.get('product');
    const message = params.get('message');

    if (service && form.service) form.service.value = service;
    if (product && form.message && !form.message.value) {
      form.message.value = 'Bonjour, je souhaite un devis pour le produit : ' + product + '.\nQuantite estimee : \nTechnique souhaitee : \nDelai cible : ';
    }
    if (message && form.message) form.message.value = message;
  }

  document.addEventListener('multipixels:cart-updated', updateCartCount);
  document.addEventListener('multipixels:client-auth-changed', ensureClientEntry);
  setActiveNav();
  updateCartCount();
  ensureClientEntry();
  applyContactPrefill();
})();
