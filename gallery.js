(function setupGalleryPage() {
  const filterButtons = document.querySelectorAll("[data-gallery-filter]");
  const cards = document.querySelectorAll("[data-gallery-card]");
  const lightbox = document.getElementById("gallery-lightbox");
  const lightboxImage = document.getElementById("gallery-lightbox-image");
  const lightboxTitle = document.getElementById("gallery-lightbox-title");
  const lightboxText = document.getElementById("gallery-lightbox-text");
  const closeButton = document.getElementById("gallery-lightbox-close");

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mobile-menu-open");
  }

  function openLightbox(card) {
    if (!lightbox || !lightboxImage || !lightboxTitle || !lightboxText) return;
    const image = card.querySelector("img");
    lightboxImage.src = image ? image.getAttribute("src") : "";
    lightboxImage.alt = image ? image.getAttribute("alt") : "";
    lightboxTitle.textContent = card.getAttribute("data-gallery-title") || "Réalisation Multipixels";
    lightboxText.textContent = card.getAttribute("data-gallery-text") || "Projet de personnalisation textile réalisé dans notre atelier.";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("mobile-menu-open");
  }

  filterButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const filter = button.getAttribute("data-gallery-filter") || "all";
      filterButtons.forEach(function (entry) {
        entry.classList.toggle("is-active", entry === button);
      });
      cards.forEach(function (card) {
        const category = card.getAttribute("data-gallery-category");
        card.hidden = !(filter === "all" || filter === category);
      });
    });
  });

  cards.forEach(function (card) {
    card.addEventListener("click", function () { openLightbox(card); });
  });

  if (closeButton) closeButton.addEventListener("click", closeLightbox);
  if (lightbox) {
    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) closeLightbox();
    });
  }
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeLightbox();
  });
})();
