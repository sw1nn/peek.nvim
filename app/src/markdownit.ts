import { hashCode, uniqueIdGen } from './util.ts';
import { parseArgs } from 'https://deno.land/std@0.217.0/cli/parse_args.ts';
import { default as highlight } from 'https://cdn.skypack.dev/highlight.js@11.9.0';
// @deno-types="https://esm.sh/v135/@types/markdown-it@13.0.7/index.d.ts";
import MarkdownIt from 'https://esm.sh/markdown-it@14.0.0';
import { full as MarkdownItEmoji } from 'https://esm.sh/markdown-it-emoji@3.0.0';
import { default as MarkdownItFootnote } from 'https://esm.sh/markdown-it-footnote@4.0.0';
import { default as MarkdownItTaskLists } from 'https://esm.sh/markdown-it-task-lists@2.1.1';
import { default as MarkdownItTexmath } from 'https://esm.sh/markdown-it-texmath@1.0.0';
import MarkdownItGithubAlerts from 'https://esm.sh/markdown-it-github-alerts@0.3.0';
import Katex from 'https://esm.sh/katex@0.16.9';

const __args = parseArgs(Deno.args);

const md = new MarkdownIt('default', {
  html: true,
  typographer: true,
  linkify: true,
  langPrefix: 'language-',
  highlight: __args['syntax'] && ((code, language) => {
    if (language && highlight.getLanguage(language)) {
      try {
        return highlight.highlight(code, { language }).value;
      } catch {
        return code;
      }
    }

    return '';
  }),
}).use(MarkdownItEmoji)
  .use(MarkdownItFootnote)
  .use(MarkdownItTaskLists, { enabled: false, label: true })
  .use(MarkdownItGithubAlerts)
  .use(MarkdownItTexmath, {
    engine: Katex,
    delimiters: ['gitlab', 'dollars'],
    katexOptions: {
      macros: { '\\R': '\\mathbb{R}' },
      strict: false,
      throwOnError: false,
    },
  });

md.renderer.rules.link_open = (tokens, idx, options) => {
  const token = tokens[idx];
  const href = token.attrGet('href');

  if (href && href.startsWith('#')) {
    token.attrSet('onclick', `location.hash='${href}'`);
  }

  token.attrSet('href', 'javascript:return');

  return md.renderer.renderToken(tokens, idx, options);
};

md.renderer.rules.heading_open = (tokens, idx, options) => {
  tokens[idx].attrSet(
    'id',
    tokens[idx + 1].content
      .trim()
      .split(' ')
      .filter((a) => a)
      .join('-')
      .replace(/[^a-z0-9-]/gi, '')
      .toLowerCase(),
  );

  return md.renderer.renderToken(tokens, idx, options);
};

md.renderer.rules.heading_close = (tokens, idx, options) => {
  const openToken = tokens[idx - 2];
  const id = openToken?.attrGet('id');

  if (id) {
    const anchor =
      `<a class="peek-heading-anchor" href="javascript:return" onclick="location.hash='#${id}'">` +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">' +
      '<path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Z"></path>' +
      '<path d="M8.225 12.725a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25Z"></path>' +
      '</svg></a>';
    return `${anchor}${md.renderer.renderToken(tokens, idx, options)}`;
  }

  return md.renderer.renderToken(tokens, idx, options);
};

md.renderer.rules.math_block = (() => {
  const math_block = md.renderer.rules.math_block!;

  return (tokens, idx, options, env, self) => {
    return `
      <div
        data-line-begin="${tokens[idx].attrGet('data-line-begin')}"
      >
        ${math_block(tokens, idx, options, env, self)}
      </div>
    `;
  };
})();

md.renderer.rules.math_block_eqno = (() => {
  const math_block_eqno = md.renderer.rules.math_block_eqno!;

  return (tokens, idx, options, env, self) => {
    return `
      <div
        data-line-begin="${tokens[idx].attrGet('data-line-begin')}"
      >
        ${math_block_eqno(tokens, idx, options, env, self)}
      </div>
    `;
  };
})();

md.renderer.rules.fence = (() => {
  const fence = md.renderer.rules.fence!;
  const escapeHtml = md.utils.escapeHtml;
  const regex = new RegExp(
    /^(?<frontmatter>---[\s\S]+---)?\s*(?<content>(?<charttype>flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|journey|C4Context|erDiagram|requirementDiagram|gitGraph)[\s\S]+)/,
  );

  const LANG_NAMES: Record<string, string> = {
    js: 'JavaScript',
    ts: 'TypeScript',
    tsx: 'TypeScript (JSX)',
    jsx: 'JavaScript (JSX)',
    rs: 'Rust',
    py: 'Python',
    rb: 'Ruby',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
    yml: 'YAML',
    yaml: 'YAML',
    md: 'Markdown',
    json: 'JSON',
    toml: 'TOML',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sql: 'SQL',
    go: 'Go',
    java: 'Java',
    kt: 'Kotlin',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    lua: 'Lua',
    vim: 'Vim Script',
    dockerfile: 'Dockerfile',
    tf: 'Terraform',
    hcl: 'HCL',
    zig: 'Zig',
    ex: 'Elixir',
    exs: 'Elixir',
    erl: 'Erlang',
    hs: 'Haskell',
    clj: 'Clojure',
    el: 'Emacs Lisp',
    swift: 'Swift',
    r: 'R',
    pl: 'Perl',
    php: 'PHP',
  };

  const COPY_ICON =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
  return (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const content = token.content.trim();
    const lang = token.info ? token.info.trim().split(/\s+/)[0] : '';

    // Detect mermaid: either ```mermaid fence or content matching known chart types
    const isMermaid = lang === 'mermaid' || regex.test(content);

    if (isMermaid) {
      const definition = lang === 'mermaid'
        ? content
        : (regex.exec(content)?.groups?.content || content);
      return `
        <div
          class="peek-mermaid-container"
          data-line-begin="${token.attrGet('data-line-begin')}"
        >
          <div
            id="graph-mermaid-${env.genId(hashCode(content))}"
            data-graph="mermaid"
            data-graph-definition="${escapeHtml(definition)}"
          >
            <div class="peek-loader"></div>
          </div>
        </div>
      `;
    }
    const lineBegin = token.attrGet('data-line-begin');

    // Remove data-line-begin from token so fence() doesn't duplicate it on <pre>
    const lineBeginIdx = token.attrIndex('data-line-begin');
    if (lineBeginIdx !== -1) {
      token.attrs!.splice(lineBeginIdx, 1);
    }

    const fenceHtml = fence(tokens, idx, options, env, self);

    if (!lang && !lineBegin) {
      return fenceHtml;
    }

    const displayLang = lang ? (LANG_NAMES[lang] || lang) : '';
    const badgeHtml = displayLang
      ? `<span class="peek-lang-badge">${escapeHtml(displayLang)}</span>`
      : '';
    const lineAttr = lineBegin ? ` data-line-begin="${lineBegin}"` : '';

    return `<div class="peek-code-block"${lineAttr}>${badgeHtml}<button class="peek-copy-btn" title="Copy code">${COPY_ICON}</button>${fenceHtml}</div>`;
  };
})();

export function render(markdown: string) {
  const tokens = md.parse(markdown, {});

  tokens.forEach((token) => {
    if (token.map && token.level === 0) {
      token.attrSet('data-line-begin', String(token.map[0] + 1));
    }
  });

  return md.renderer.render(tokens, md.options, { genId: uniqueIdGen() });
}
