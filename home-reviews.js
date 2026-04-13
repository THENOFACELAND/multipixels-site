(function setupHomeReviews() {
  const grid = document.getElementById("home-reviews-grid");
  if (!grid) return;

  const ratingNode = document.getElementById("home-reviews-rating");
  const countNode = document.getElementById("home-reviews-count");
  const updatedNode = document.getElementById("home-reviews-updated");
  const linkNode = document.getElementById("home-reviews-link");

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cleanText(value, options) {
    const preserveLineBreaks = Boolean(options && options.preserveLineBreaks);
    let text = String(value || "")
      .normalize("NFC")
      .replace(/\u00a0/g, " ")
      .replace(/\u200b/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    if (!preserveLineBreaks) {
      text = text.replace(/\n+/g, " ");
    }

    return text.trim();
  }

  function formatUpdatedAt(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }

  function buildStars(rating) {
    const safeRating = Math.max(0, Math.min(5, Number(rating || 0)));
    return "\u2605".repeat(safeRating) + "\u2606".repeat(5 - safeRating);
  }

  function buildReviewCard(review) {
    return [
      '<article class="quote-card home-review-card reveal is-visible">',
      '<div class="home-review-mark" aria-hidden="true">\u2605</div>',
      '<div class="home-review-top">',
      '<div class="home-review-meta"><strong>' + escapeHtml(review.author) + '</strong><span>' + escapeHtml(review.time) + '</span></div>',
      '<div class="home-review-stars" aria-label="Note ' + escapeHtml(review.rating) + ' sur 5">' + escapeHtml(buildStars(review.rating)) + '</div>',
      '</div>',
      '<p>' + escapeHtml(review.text) + '</p>',
      '</article>'
    ].join("");
  }

  function render(payload) {
    if (!payload || payload.ok === false) return;

    const rating = Number(payload.rating || 0);
    const ratingCount = Number(payload.ratingCount || 0);
    const url = cleanText(payload.url || "");
    const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    const cleaned = reviews
      .map(function (review) {
        const normalizedText = cleanText(review.text || "", { preserveLineBreaks: true });
        return {
          author: cleanText(review.author || "Client Google"),
          text: normalizedText && !/^Avis client Google$/i.test(normalizedText) ? normalizedText : "Avis publi\u00e9 sur Google.",
          time: cleanText(review.time || "Avis r\u00e9cent"),
          rating: Number(review.rating || 0)
        };
      })
      .filter(function (review) {
        return review.rating > 0 && review.text;
      });

    if (ratingNode && rating > 0) ratingNode.textContent = String(rating).replace(/\.0$/, "") + "/5";
    if (countNode && ratingCount > 0) countNode.textContent = ratingCount + " avis Google";
    if (updatedNode) {
      const label = formatUpdatedAt(payload.generatedAt);
      if (label) updatedNode.textContent = "Derni\u00e8re mise \u00e0 jour : " + label;
    }
    if (linkNode && url) linkNode.href = url;

    if (!cleaned.length) {
      grid.innerHTML = "";
      return;
    }

    grid.innerHTML = cleaned.map(buildReviewCard).join("");
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("reviews_fetch_failed");
      return response.json();
    });
  }

  fetchJson("/api/google-reviews")
    .then(render)
    .catch(function () {
      return fetchJson("assets/data/google-reviews.json")
        .then(render)
        .catch(function () {
          /* static fallback already in markup */
        });
    });
})();

