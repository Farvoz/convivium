// Классический скрипт (работает и с file://). Адаптер горизонтального
// pointer-жеста. Инкапсулирует захват/перетаскивание/порог; игровую семантику
// (что значит свайп) оставляет вызывающему через колбэки decide/perform.
// Тайминги (autoTimer) и занятость (busy) остаются в UI-слое.
(function () {
  function enableGesture(el, opts = {}) {
    const { threshold = 60, decide, perform, onStart } = opts;
    let startX = null, dx = 0;
    el.onpointerdown = (e) => {
      if (onStart) onStart();
      startX = e.clientX; dx = 0;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      if (e.cancelable) e.preventDefault();
    };
    el.onpointermove = (e) => {
      if (startX == null) return;
      dx = e.clientX - startX;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      if (e.cancelable) e.preventDefault();
    };
    el.onpointerup = (e) => {
      if (startX == null) return;
      el.classList.remove('dragging');
      const action = decide ? decide(dx) : null;
      el.style.transform = '';
      startX = null;
      if (action) perform(action);
    };
    el.onpointercancel = () => {
      if (onStart) onStart();
      startX = null; el.classList.remove('dragging'); el.style.transform = '';
    };
  }

  function disableGesture(el) {
    el.onpointerdown = el.onpointermove = el.onpointerup = el.onpointercancel = null;
    el.classList.remove('dragging');
    el.style.transform = '';
  }

  globalThis.Convivium.enableGesture = enableGesture;
  globalThis.Convivium.disableGesture = disableGesture;
})();
