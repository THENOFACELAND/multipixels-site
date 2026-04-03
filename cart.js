(function setupCartPage() {
  const store = window.MULTIPIXELS_STORE;
  if (!store) return;

  const list = document.getElementById("cart-list");
  const emptyState = document.getElementById("cart-empty");
  const subtotalNode = document.getElementById("cart-subtotal");
  const itemCountNode = document.getElementById("cart-item-count");
  const totalNode = document.getElementById("cart-total");
  const checkoutButton = document.getElementById("checkout-button");
  const clearButton = document.getElementById("clear-cart-button");
  const checkoutMessage = document.getElementById("checkout-message");

  function formatPrice(value) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: store.currency || "EUR" }).format(Number(value || 0));
  }

  function loadCart() {
    try {
      const raw = window.localStorage.getItem("multipixels_cart");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveCart(cart) {
    window.localStorage.setItem("multipixels_cart", JSON.stringify(cart));
    document.dispatchEvent(new CustomEvent("multipixels:cart-updated"));
  }

  function findProduct(id) {
    return (store.products || []).find(function (product) { return product.id === id; });
  }

  function setMessage(message, isError, isSuccess) {
    if (!checkoutMessage) return;
    checkoutMessage.textContent = message || "";
    checkoutMessage.classList.toggle("is-error", !!isError);
    checkoutMessage.classList.toggle("is-success", !!isSuccess);
  }

  function updateQuantity(id, nextQuantity) {
    const cart = loadCart();
    const item = cart.find(function (entry) { return entry.id === id; });
    if (!item) return;
    item.quantity = Math.max(1, Number(nextQuantity || 1));
    saveCart(cart);
    render();
  }

  function removeItem(id) {
    saveCart(loadCart().filter(function (item) { return item.id !== id; }));
    render();
  }

  function clearCart() {
    saveCart([]);
    render();
  }

  async function startCheckout() {
    const cart = loadCart();
    if (!cart.length) {
      setMessage("Votre panier est vide.", true, false);
      return;
    }

    setMessage("Préparation du checkout...", false, false);

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ items: cart })
      });

      const body = await response.json().catch(function () { return null; });
      if (!response.ok || !body || !body.ok) {
        throw new Error(body && body.error && body.error.message ? body.error.message : "Checkout indisponible pour le moment.");
      }

      if (body.url) {
        window.location.href = body.url;
        return;
      }

      setMessage(body.message || "Session checkout préparée.", false, true);
    } catch (error) {
      setMessage(error && error.message ? error.message : "Checkout indisponible pour le moment.", true, false);
    }
  }

  function cartCard(item) {
    const product = findProduct(item.id) || item;
    const lineTotal = Number(product.price || item.price || 0) * Number(item.quantity || 0);
    return [
      '<article class="cart-card">',
      '<div class="cart-card-media"><img src="' + (product.image || item.image) + '" alt="' + (product.imageAlt || item.imageAlt || product.name || item.name) + '" loading="lazy" /></div>',
      '<div class="cart-card-body">',
      '<div class="cart-row"><div><h3>' + (product.name || item.name) + '</h3><p class="product-description">' + (product.shortDescription || product.description || "Produit sélectionné dans le catalogue Multipixels.") + '</p></div><button class="btn btn-outline" type="button" data-remove-item="' + item.id + '">Supprimer</button></div>',
      '<div class="product-techniques">' + (product.techniques || []).map(function (technique) { return '<span class="tag">' + technique + '</span>'; }).join("") + '</div>',
      '<div class="cart-row"><div class="quantity-control"><button type="button" data-quantity-step="-1" data-quantity-id="' + item.id + '">-</button><input type="number" min="1" value="' + item.quantity + '" data-quantity-input="' + item.id + '" /><button type="button" data-quantity-step="1" data-quantity-id="' + item.id + '">+</button></div><div><span class="product-price">' + formatPrice(product.price || item.price || 0) + '</span><span class="product-minimum">Ligne : ' + formatPrice(lineTotal) + '</span></div></div>',
      '</div>',
      '</article>'
    ].join("");
  }

  function render() {
    if (!list || !emptyState || !subtotalNode || !itemCountNode || !totalNode) return;
    const cart = loadCart();
    const subtotal = cart.reduce(function (sum, item) {
      const product = findProduct(item.id) || item;
      return sum + Number(product.price || item.price || 0) * Number(item.quantity || 0);
    }, 0);
    const itemCount = cart.reduce(function (sum, item) { return sum + Number(item.quantity || 0); }, 0);

    list.innerHTML = cart.map(cartCard).join("");
    emptyState.hidden = cart.length > 0;
    list.hidden = cart.length === 0;
    subtotalNode.textContent = formatPrice(subtotal);
    totalNode.textContent = formatPrice(subtotal);
    itemCountNode.textContent = String(itemCount);
    if (checkoutButton) checkoutButton.disabled = cart.length === 0;

    list.querySelectorAll("[data-remove-item]").forEach(function (button) {
      button.addEventListener("click", function () { removeItem(button.getAttribute("data-remove-item")); });
    });

    list.querySelectorAll("[data-quantity-step]").forEach(function (button) {
      button.addEventListener("click", function () {
        const id = button.getAttribute("data-quantity-id");
        const step = Number(button.getAttribute("data-quantity-step") || 0);
        const input = list.querySelector('[data-quantity-input="' + id + '"]');
        const current = input ? Number(input.value || 1) : 1;
        updateQuantity(id, current + step);
      });
    });

    list.querySelectorAll("[data-quantity-input]").forEach(function (input) {
      input.addEventListener("change", function () {
        updateQuantity(input.getAttribute("data-quantity-input"), input.value);
      });
    });

    document.dispatchEvent(new CustomEvent("multipixels:cart-updated"));
  }

  if (checkoutButton) checkoutButton.addEventListener("click", startCheckout);
  if (clearButton) clearButton.addEventListener("click", clearCart);
  render();
})();
