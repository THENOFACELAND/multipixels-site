(function setupScroll3D() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const mobileQuery = window.matchMedia("(max-width: 860px)");
  if (mobileQuery.matches) {
    return;
  }

  const blocks = Array.from(
    document.querySelectorAll("main .content-shell > section, main .content-shell > .section-head")
  );

  if (!blocks.length) {
    return;
  }

  blocks.forEach((block) => block.classList.add("scroll-3d-block"));

  let ticking = false;

  function apply3D() {
    ticking = false;
    const vh = window.innerHeight || 1;
    const center = vh * 0.5;

    blocks.forEach((block) => {
      const rect = block.getBoundingClientRect();
      const blockCenter = rect.top + rect.height * 0.5;
      const rawProgress = (center - blockCenter) / vh;
      const progress = Math.max(-1, Math.min(1, rawProgress));

      const ty = -progress * 18;
      const rx = progress * 3.8;
      const ry = Math.sin(progress * 2.2) * 2.4;
      const scale = 1 - Math.abs(progress) * 0.018;

      block.style.setProperty("--s3d-ty", ty.toFixed(2) + "px");
      block.style.setProperty("--s3d-rx", rx.toFixed(2) + "deg");
      block.style.setProperty("--s3d-ry", ry.toFixed(2) + "deg");
      block.style.setProperty("--s3d-scale", scale.toFixed(4));
    });
  }

  function requestTick() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(apply3D);
  }

  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", requestTick);

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", function (event) {
      if (event.matches) {
        blocks.forEach((block) => {
          block.style.removeProperty("--s3d-ty");
          block.style.removeProperty("--s3d-rx");
          block.style.removeProperty("--s3d-ry");
          block.style.removeProperty("--s3d-scale");
          block.classList.remove("scroll-3d-block");
        });
      } else {
        blocks.forEach((block) => block.classList.add("scroll-3d-block"));
        requestTick();
      }
    });
  }

  apply3D();
})();
