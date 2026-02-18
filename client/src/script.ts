import { debounce, findLast, getInjectConfig } from './util.ts';
import { slidingWindows } from 'https://deno.land/std@0.217.0/collections/sliding_windows.ts';
// @deno-types="https://raw.githubusercontent.com/patrick-steele-idem/morphdom/master/index.d.ts"
import morphdom from 'https://esm.sh/morphdom@2.7.2?no-dts';
import mermaid from './mermaid.ts';

const window = globalThis;
// const _log = Reflect.get(window, '_log');

addEventListener('DOMContentLoaded', () => {
  const body = document.body;
  const markdownBody = document.getElementById('peek-markdown-body') as HTMLDivElement;
  const base = document.getElementById('peek-base') as HTMLBaseElement;
  const peek = getInjectConfig();
  let source: { lcount: number } | undefined;
  let blocks: HTMLElement[][] | undefined;
  let scroll: { line: number } | undefined;

  const zoom = {
    level: 100,
    zoomMin: 50,
    zoomMax: 250,
    zoomStep: 10,
    zoomLabel: document.getElementById('peek-zoom-label') as HTMLDivElement,
    init() {
      this.level = Number(localStorage.getItem('zoom-level')) || this.level;
      this.update(this.level === 100);
    },
    up() {
      this.level = Math.min(this.level + this.zoomStep, this.zoomMax);
      this.update();
    },
    down() {
      this.level = Math.max(this.level - this.zoomStep, this.zoomMin);
      this.update();
    },
    reset() {
      this.level = 100;
      this.update();
    },
    update(silent?: boolean) {
      localStorage.setItem('zoom-level', String(this.level));
      markdownBody.style.setProperty('font-size', `${this.level}%`);
      if (silent) return;
      this.zoomLabel.textContent = `${this.level}%`;
      this.zoomLabel.animate([
        { opacity: 1 },
        { opacity: 1, offset: 0.75 },
        { opacity: 0 },
      ], { duration: 1000 });
    },
  };

  if (peek.theme) body.setAttribute('data-theme', peek.theme);
  if (peek.ctx === 'webview') zoom.init();

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    const ctrl: Record<string, () => void> = {
      '=': zoom.up.bind(zoom),
      '-': zoom.down.bind(zoom),
      '0': zoom.reset.bind(zoom),
    };
    const plain: Record<string, () => void> = {
      'j': () => {
        window.scrollBy({ top: 50 });
      },
      'k': () => {
        window.scrollBy({ top: -50 });
      },
      'd': () => {
        window.scrollBy({ top: window.innerHeight / 2 });
      },
      'u': () => {
        window.scrollBy({ top: -window.innerHeight / 2 });
      },
      'g': () => {
        window.scrollTo({ top: 0 });
      },
      'G': () => {
        window.scrollTo({ top: document.body.scrollHeight });
      },
    };
    const action = event.ctrlKey && peek.ctx === 'webview' ? ctrl[event.key] : plain[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  });

  const COPY_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
  const CHECK_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

  function showCopiedFeedback(btn: HTMLElement) {
    btn.innerHTML = CHECK_SVG;
    btn.classList.add('peek-copy-btn--copied');

    const tooltip = document.createElement('span');
    tooltip.className = 'peek-tooltip';
    tooltip.textContent = 'Copied!';
    document.body.appendChild(tooltip);

    const rect = btn.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
    tooltip.style.top = `${rect.top - tooltip.offsetHeight - 6}px`;
    requestAnimationFrame(() => tooltip.classList.add('peek-tooltip--visible'));

    setTimeout(() => {
      tooltip.remove();
      btn.innerHTML = COPY_SVG;
      btn.classList.remove('peek-copy-btn--copied');
    }, 2000);
  }

  markdownBody.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('.peek-copy-btn') as HTMLButtonElement | null;
    if (!btn) return;

    const pre = btn.parentElement?.querySelector('pre code') as HTMLElement | null;
    if (!pre) return;

    navigator.clipboard.writeText(pre.textContent || '').then(() => {
      showCopiedFeedback(btn);
    });
  });

  onload = () => {
    const item = sessionStorage.getItem('session');
    if (item) {
      const session = JSON.parse(item);
      base.href = session.base;
      onPreview({ html: session.html, lcount: session.lcount });
      onScroll({ line: session.line });
    }
  };

  onbeforeunload = () => {
    sessionStorage.setItem(
      'session',
      JSON.stringify({
        base: base.href,
        html: markdownBody.innerHTML,
        lcount: source?.lcount,
        line: scroll?.line,
      }),
    );
  };

  const decoder = new TextDecoder();
  const socket = new WebSocket(`ws://${peek.serverUrl}/`);

  socket.binaryType = 'arraybuffer';

  socket.onclose = (event) => {
    if (!event.wasClean) {
      close();
      location.reload();
    }
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(decoder.decode(event.data));

    switch (data.action) {
      case 'show':
        onPreview(data);
        break;
      case 'scroll':
        onScroll(data);
        break;
      case 'base':
        base.href = data.base;
        break;
      default:
        break;
    }
  };

  const onPreview = (() => {
    mermaid.init();

    type MermaidState = { scale: number; tx: number; ty: number };
    const mermaidStates = new WeakMap<Element, MermaidState>();
    const PAN_STEP = 50;
    const ZOOM_STEP = 0.15;
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 4;

    function getMermaidState(container: Element): MermaidState {
      let state = mermaidStates.get(container);
      if (!state) {
        state = { scale: 1, tx: 0, ty: 0 };
        mermaidStates.set(container, state);
      }
      return state;
    }

    function applyMermaidTransform(container: Element) {
      const viewport = container.querySelector('.peek-mermaid-viewport') as HTMLElement | null;
      if (!viewport) return;
      const state = getMermaidState(container);
      viewport.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    }

    function injectMermaidControls(container: Element) {
      if (container.querySelector('.peek-mermaid-toolbar')) return;

      const toolbar = document.createElement('div');
      toolbar.className = 'peek-mermaid-toolbar';
      toolbar.innerHTML = [
        '<button class="peek-mermaid-btn" data-action="fit" title="Fit to width">',
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.56 7h10.88l-2.22-2.22a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l2.22-2.22H2.56l2.22 2.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215l-3.5-3.5a.75.75 0 0 1 0-1.06Z"/></svg>',
        '</button>',
        '<button class="peek-mermaid-btn" data-action="copy-source" title="Copy source">',
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>',
        '</button>',
      ].join('');

      const nav = document.createElement('div');
      nav.className = 'peek-mermaid-nav';
      nav.innerHTML = [
        '<span></span>',
        '<button class="peek-mermaid-btn" data-action="pan-up" title="Pan up">\u25B2</button>',
        '<span></span>',
        '<button class="peek-mermaid-btn" data-action="pan-left" title="Pan left">\u25C0</button>',
        '<button class="peek-mermaid-btn" data-action="reset" title="Reset view">\u25CB</button>',
        '<button class="peek-mermaid-btn" data-action="pan-right" title="Pan right">\u25B6</button>',
        '<button class="peek-mermaid-btn" data-action="zoom-out" title="Zoom out">\u2212</button>',
        '<button class="peek-mermaid-btn" data-action="pan-down" title="Pan down">\u25BC</button>',
        '<button class="peek-mermaid-btn" data-action="zoom-in" title="Zoom in">+</button>',
      ].join('');

      container.appendChild(toolbar);
      container.appendChild(nav);
    }

    markdownBody.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement).closest('.peek-mermaid-btn') as HTMLElement | null;
      if (!btn) return;

      const container = btn.closest('.peek-mermaid-container');
      if (!container) return;

      const action = btn.getAttribute('data-action');
      const state = getMermaidState(container);

      switch (action) {
        case 'pan-up':
          state.ty += PAN_STEP;
          break;
        case 'pan-down':
          state.ty -= PAN_STEP;
          break;
        case 'pan-left':
          state.tx += PAN_STEP;
          break;
        case 'pan-right':
          state.tx -= PAN_STEP;
          break;
        case 'zoom-in':
          state.scale = Math.min(state.scale + ZOOM_STEP, ZOOM_MAX);
          break;
        case 'zoom-out':
          state.scale = Math.max(state.scale - ZOOM_STEP, ZOOM_MIN);
          break;
        case 'reset':
          state.scale = 1;
          state.tx = 0;
          state.ty = 0;
          break;
        case 'fit': {
          const viewport = container.querySelector('.peek-mermaid-viewport') as HTMLElement | null;
          const svgEl = viewport?.querySelector('svg');
          if (viewport && svgEl) {
            const containerWidth = container.clientWidth - 32;
            const svgWidth = svgEl.getBoundingClientRect().width / state.scale;
            if (svgWidth > 0) {
              state.scale = containerWidth / svgWidth;
              state.tx = 0;
              state.ty = 0;
            }
          }
          break;
        }
        case 'copy-source': {
          const graphEl = container.querySelector('[data-graph-definition]');
          const src = graphEl?.getAttribute('data-graph-definition') || '';
          navigator.clipboard.writeText(src).then(() => {
            showCopiedFeedback(btn);
          });
          return;
        }
        default:
          return;
      }

      applyMermaidTransform(container);
    });

    const renderMermaid = debounce(
      (() => {
        const parser = new DOMParser();

        async function render(el: Element) {
          const svg = await mermaid.render(
            `${el.id}-svg`,
            el.getAttribute('data-graph-definition')!,
            el,
          );

          if (svg) {
            const svgElement = parser.parseFromString(svg, 'text/html').body;
            const viewport = document.createElement('div');
            viewport.className = 'peek-mermaid-viewport';
            viewport.appendChild(svgElement);
            el.appendChild(viewport);
            el.parentElement?.style.setProperty(
              'height',
              window.getComputedStyle(svgElement).getPropertyValue('height'),
            );
            if (el.parentElement) {
              injectMermaidControls(el.parentElement);
            }
          }
        }

        return () => {
          Array.from(markdownBody.querySelectorAll('div[data-graph="mermaid"]'))
            .filter((el) => !el.querySelector('svg'))
            .forEach(render);
        };
      })(),
      200,
    );

    const morphdomOptions: Parameters<typeof morphdom>[2] = {
      childrenOnly: true,
      getNodeKey: (node) => {
        if (node instanceof HTMLElement && node.getAttribute('data-graph') === 'mermaid') {
          return node.id;
        }
        return null;
      },
      onNodeAdded: (node) => {
        if (node instanceof HTMLElement && node.getAttribute('data-graph') === 'mermaid') {
          renderMermaid();
        }
        return node;
      },
      onBeforeElUpdated: (fromEl: HTMLElement, toEl: HTMLElement) => {
        if (fromEl.hasAttribute('open')) {
          toEl.setAttribute('open', 'true');
        } else if (
          fromEl.classList.contains('peek-mermaid-container') &&
          toEl.classList.contains('peek-mermaid-container')
        ) {
          toEl.style.height = fromEl.style.height;
        }
        return !fromEl.isEqualNode(toEl);
      },
      onBeforeElChildrenUpdated(_, toEl) {
        return toEl.getAttribute('data-graph') !== 'mermaid';
      },
    };

    const mutationObserver = new MutationObserver(() => {
      blocks = slidingWindows(Array.from(document.querySelectorAll('[data-line-begin]')), 2, {
        step: 1,
        partial: true,
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (scroll) onScroll(scroll);
    });

    mutationObserver.observe(markdownBody, { childList: true });
    resizeObserver.observe(markdownBody);

    return (data: { html: string; lcount: number }) => {
      source = { lcount: data.lcount };
      morphdom(markdownBody, `<main>${data.html}</main>`, morphdomOptions);
    };
  })();

  const onScroll = (() => {
    function getBlockOnLine(line: number) {
      return findLast(blocks, (block) => line >= Number(block[0].dataset.lineBegin));
    }

    function getOffset(elem: HTMLElement): number {
      let current: HTMLElement | null = elem;
      let top = 0;

      while (top === 0 && current) {
        top = current.getBoundingClientRect().top;
        current = current.parentElement;
      }

      return top + window.scrollY;
    }

    return (data: { line: number }) => {
      scroll = data;

      if (!blocks || !blocks[0] || !source) return;

      const block = getBlockOnLine(data.line) || blocks[0];
      const target = block[0];
      const next = target ? block[1] : blocks[0][0];

      const offsetBegin = target ? getOffset(target) : 0;
      const offsetEnd = next
        ? getOffset(next)
        : offsetBegin + target.getBoundingClientRect().height;

      const lineBegin = target ? Number(target.dataset.lineBegin) : 1;
      const lineEnd = next ? Number(next.dataset.lineBegin) : source.lcount + 1;

      const pixPerLine = (offsetEnd - offsetBegin) / (lineEnd - lineBegin);
      const scrollPix = (data.line - lineBegin) * pixPerLine;

      window.scroll({ top: offsetBegin + scrollPix - window.innerHeight / 2 + pixPerLine / 2 });
    };
  })();
});
