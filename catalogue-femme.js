(function setupCatalogueFemmeGalleries() {
  const cards = document.querySelectorAll('[data-product-gallery]');

  const closeAll = function (except) {
    cards.forEach(function (otherCard) {
      const otherDropdown = otherCard.querySelector('[data-color-dropdown]');
      const otherTrigger = otherCard.querySelector('[data-color-trigger]');
      if (!otherDropdown || otherDropdown === except) return;
      otherDropdown.classList.remove('is-open');
      if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
    });
  };

  cards.forEach(function (card) {
    const image = card.querySelector('[data-product-image]');
    const label = card.querySelector('[data-product-color-label]');
    const dropdown = card.querySelector('[data-color-dropdown]');
    const trigger = card.querySelector('[data-color-trigger]');
    const currentName = card.querySelector('[data-color-current-name]');
    const currentSwatch = card.querySelector('[data-color-current-swatch]');
    const options = Array.from(card.querySelectorAll('[data-color-option]'));
    if (!image || !label || !dropdown || !trigger || !currentName || !currentSwatch || !options.length) return;

    const sync = function (option) {
      if (!option) return;
      image.src = option.getAttribute('data-color-image') || image.src;
      image.alt = option.getAttribute('data-color-alt') || image.alt;
      label.textContent = option.getAttribute('data-color-name') || '';
      currentName.textContent = option.getAttribute('data-color-name') || '';
      currentSwatch.style.background = option.getAttribute('data-color-hex') || '#d8dde7';

      options.forEach(function (item) {
        const isActive = item === option;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    };

    trigger.addEventListener('click', function () {
      const isOpen = dropdown.classList.contains('is-open');
      closeAll(dropdown);
      dropdown.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        sync(option);
        dropdown.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      });
    });

    sync(options[0]);
  });

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-color-dropdown]')) return;
    closeAll();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    closeAll();
  });
})();
