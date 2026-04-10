(async function setupCataloguePage() {
  const store = window.MULTIPIXELS_STORE;
  if (!store || !Array.isArray(store.products)) return;

  async function loadProducts() {
    const baseProducts = store.products.slice();
    try {
      const response = await fetch('/api/catalogue-extra-products', { cache: 'no-store' });
      if (!response.ok) return baseProducts;
      const payload = await response.json();
      const extra = payload && Array.isArray(payload.products) payload.products : [];
      return baseProducts.concat(extra);
    } catch (_) {
      return baseProducts;
    }
  }

  const products = await loadProducts();
  const grid = document.getElementById('catalogue-grid');
  const previewGrid = document.getElementById('catalogue-preview-grid');
  const featuredTitle = document.getElementById('featured-product-title');
  const featuredText = document.getElementById('featured-product-text');
  const featuredImage = document.getElementById('featured-product-image');
  const filterButtons = document.querySelectorAll('[data-filter]');
  const segmentButtons = document.querySelectorAll('[data-segment-filter]');
  const quoteButtons = document.querySelectorAll('[data-featured-product-link]');
  const initialSegment = document.body.getAttribute('data-catalogue-segment') || 'all';

  function loadCart() {
    try {
      const raw = window.localStorage.getItem('multipixels_cart');
      const parsed = raw JSON.parse(raw) : [];
      return Array.isArray(parsed) parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveCart(cart) {
    window.localStorage.setItem('multipixels_cart', JSON.stringify(cart));
    document.dispatchEvent(new CustomEvent('multipixels:cart-updated'));
  }

  function addToCart(productId) {
    const product = products.find(function (entry) { return entry.id === productId; });
    if (!product) return;

    const cart = loadCart();
    const existing = cart.find(function (entry) { return entry.id === product.id; });

    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        id: product.id,
        quantity: 1,
        name: product.name,
        price: product.discountPrice > 0 product.discountPrice : product.price,
        image: product.image,
        imageAlt: product.imageAlt,
        category: product.category,
        color: (product.colors && product.colors[0]) || 'À définir',
        size: (product.sizes && product.sizes[0]) || 'À définir'
      });
    }

    saveCart(cart);
    const button = document.querySelector('[data-add-to-cart="' + product.id + '"]');
    if (button) {
      const original = button.textContent;
      button.textContent = 'Ajouté';
      window.setTimeout(function () {
        button.textContent = original;
      }, 1200);
    }
  }  function colorToCss(value) {
    const key = String(value || '').trim().toLowerCase();
    const palette = {
      noir: '#1f2024',
      black: '#1f2024',
      blanc: '#f5f6f8',
      white: '#f5f6f8',
      navy: '#213f8d',
      marine: '#213f8d',
      'bleu marine': '#213f8d',
      bleu: '#2f66d0',
      'bleu royal': '#2f66d0',
      royal: '#2f66d0',
      rouge: '#d1424a',
      red: '#d1424a',
      rose: '#ea5a8b',
      fuchsia: '#d93584',
      gris: '#9aa3b0',
      'gris fonce': '#5f6672',
      anthracite: '#4b5059',
      vert: '#2f8f69',
      beige: '#d9ccb4',
      marron: '#7b5840',
      jaune: '#e0b63a',
      orange: '#ea7d2c',
      violet: '#7453c8',
      atoll: '#2aa8b8'
    };
    return palette[key] || '#c9d2df';
  }

  function formatEuroCompact(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function buildColorDots(colors) {
    const items = Array.isArray(colors) colors.filter(Boolean) : [];
    if (!items.length) return '';
    const visible = items.slice(0, 6).map(function (color) {
      return '<span class="product-color-dot" title="' + color + '" style="--dot:' + colorToCss(color) + '"></span>';
    }).join('');
    const extra = items.length > 6 '<span class="product-color-more">+' + (items.length - 6) + '</span>' : '';
    return '<div class="product-color-row">' + visible + extra + '</div>';
  }

  function productCard(product) {
    const isOutOfStock = product.stockStatus === 'out-of-stock';
    const hasDiscount = Number(product.discountPrice || 0) > 0 && Number(product.discountPrice) < Number(product.price || 0);
    const discountPercent = hasDiscount
      (Number(product.discountPercent || 0) || Math.round(((Number(product.price || 0) - Number(product.discountPrice || 0)) / Number(product.price || 1)) * 100))
      : 0;
    const colorRow = buildColorDots(product.colors);
    const primaryPrice = hasDiscount formatEuroCompact(product.discountPrice) : formatEuroCompact(product.price);
    const oldPrice = hasDiscount '<span class="product-price-old">' + formatEuroCompact(product.price) + '</span>' : '';
    return [
      '<article class="product-card product-card-retail reveal" data-category="' + product.category + '" data-segments="' + (Array.isArray(product.segmentGroups) product.segmentGroups.join(' ') : '') + '">',
      '<div class="product-card-image product-card-image-retail">',
      (hasDiscount '<span class="product-discount-badge">-' + discountPercent + '%</span>' : ''),
      '<img src="' + product.image + '" alt="' + product.imageAlt + '" loading="lazy" />',
      '<a class="product-image-cta" href="contact.htmlservice=devis&product=' + encodeURIComponent(product.name) + '">Personnalisez-le !</a>',
      '</div>',
      '<div class="product-card-body product-card-body-retail">',
      colorRow,
      '<div class="product-card-copy">',
      '<h3>' + product.name + '</h3>',
      '<p class="product-description">' + (product.shortDescription || '') + '</p>',
      '</div>',
      '<div class="product-price-prefix">À partir de :</div>',
      '<div class="product-retail-footer">',
      '<div class="product-retail-prices"><span class="product-price">' + primaryPrice + '</span>' + oldPrice + '</div>',
      '<button class="btn product-buy-btn" type="button" data-add-to-cart="' + product.id + '"' + (isOutOfStock ' disabled aria-disabled="true"' : '') + '>' + (isOutOfStock 'Indisponible' : 'Acheter') + '</button>',
      '</div>',
      '</div>',
      '</article>'
    ].join('');
  }

  function observeReveal(target) {
    if (!window.IntersectionObserver) {
      target.querySelectorAll('.reveal').forEach(function (node) { node.classList.add('is-visible'); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    target.querySelectorAll('.reveal').forEach(function (node) {
      observer.observe(node);
    });
  }

  function renderGrid(target, collection) {
    if (!target) return;
    target.innerHTML = collection.map(productCard).join('');
    target.querySelectorAll('[data-add-to-cart]').forEach(function (button) {
      button.addEventListener('click', function () {
        addToCart(button.getAttribute('data-add-to-cart'));
      });
    });
    observeReveal(target);
  }

  function applyCatalogueFilter(mode, value) {
    if (!grid) return;
    grid.querySelectorAll('.product-card').forEach(function (card) {
      const category = card.getAttribute('data-category') || '';
      const segments = (card.getAttribute('data-segments') || '').split(/\s+/).filter(Boolean);
      const show = mode === 'segment'
        value === 'all' || segments.indexOf(value) !== -1
        : value === 'all' || category === value;
      card.hidden = !show;
    });
  }

  function syncSegmentState(activeSegment) {
    segmentButtons.forEach(function (entry) {
      entry.classList.toggle('is-active', (entry.getAttribute('data-segment-filter') || '') === activeSegment);
    });
  }

  const featured = products.find(function (product) { return product.featured; }) || products[0];
  if (featured && featuredTitle && featuredText && featuredImage) {
    featuredTitle.textContent = featured.name;
    featuredText.textContent = featured.description || featured.shortDescription || '';
    featuredImage.src = featured.image;
    featuredImage.alt = featured.imageAlt;
    quoteButtons.forEach(function (button) {
      button.href = 'contact.htmlservice=devis&product=' + encodeURIComponent(featured.name);
    });
  }

  if (previewGrid) {
    renderGrid(previewGrid, products.slice(0, 3));
  }

  if (grid) {
    renderGrid(grid, products);

    filterButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        const filter = button.getAttribute('data-filter') || 'all';
        filterButtons.forEach(function (entry) {
          entry.classList.toggle('is-active', entry === button);
        });
        syncSegmentState('all');
        applyCatalogueFilter('category', filter);
      });
    });

    if (initialSegment && initialSegment !== 'all') {
      filterButtons.forEach(function (entry) { entry.classList.remove('is-active'); });
      syncSegmentState(initialSegment);
      applyCatalogueFilter('segment', initialSegment);
    } else {
      syncSegmentState('all');
    }
  }
})();



