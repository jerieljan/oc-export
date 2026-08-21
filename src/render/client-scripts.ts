import type { ResolvedNavigationConfig } from "../config.js";

export function scripts(navigation?: ResolvedNavigationConfig): string {
  return `
(function() {
  const toggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const stored = localStorage.getItem('opencode-theme');
  if (stored === 'dark') {
    root.classList.add('dark');
  }

  toggle.addEventListener('click', function() {
    const isDark = root.classList.toggle('dark');
    localStorage.setItem('opencode-theme', isDark ? 'dark' : 'light');
  });

  const download = document.getElementById('download-toggle');
  download.addEventListener('click', function() {
    const html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = (document.title || 'page').replace(/[^\\w\\-]+/g, '_').replace(/^_+|_+$/g, '') || 'page';
    link.download = filename + '.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

${navigation ? scrubberScripts(navigation) : ""}})();
`;
}

function scrubberScripts(navigation: ResolvedNavigationConfig): string {
  const progressBar = navigation.progressBar;
  const progressInit = progressBar
    ? "const progress = document.getElementById('turn-scrubber-progress');"
    : "";
  const progressUpdate = progressBar
    ? "if (progress) { progress.style.width = ((activeIndex + 1) / total * 100) + '%'; }"
    : "";

  return `
  const scrubber = document.querySelector('.turn-scrubber');
  if (scrubber) {
    const turnArticles = document.querySelectorAll('.turn');
    const scrubberLinks = document.querySelectorAll('.turn-scrubber-link');
    ${progressInit}
    const total = turnArticles.length;

    if (total > 0 && scrubberLinks.length === total) {
      const intersecting = new Array(total).fill(false);
      const header = document.querySelector('.site-header');
      const barHeight = scrubber.offsetHeight;
      const headerHeight = header ? header.offsetHeight : 0;
      const activeZoneHeight = Math.min(200, window.innerHeight * 0.25);
      const bottomMargin = Math.max(
        0,
        window.innerHeight - headerHeight - barHeight - activeZoneHeight,
      );
      const rootMargin = '-' + (headerHeight + 8) + 'px 0px -' + bottomMargin + 'px 0px';

      function updateActive() {
        const activeIndex = intersecting.findIndex(Boolean);
        if (activeIndex === -1) return;

        scrubberLinks.forEach((link, i) => {
          const isActive = i === activeIndex;
          link.classList.toggle('active-turn', isActive);
          if (isActive) {
            link.setAttribute('aria-current', 'true');
            link.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'center',
            });
          } else {
            link.removeAttribute('aria-current');
          }
        });

        ${progressUpdate}
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const turnIndex = Number(entry.target.getAttribute('id')?.replace('turn-', ''));
            if (!Number.isNaN(turnIndex) && turnIndex >= 0 && turnIndex < total) {
              intersecting[turnIndex] = entry.isIntersecting;
            }
          });
          updateActive();
        },
        { rootMargin, threshold: 0 },
      );

      turnArticles.forEach((turn) => observer.observe(turn));
      intersecting[0] = true;
      updateActive();
    }
  }
`;
}
