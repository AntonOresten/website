import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const buildRoot = path.join(root, 'build');
const categoriesRoot = path.join(root, 'categories');
const contentDir = path.join(buildRoot, 'content');
const outputJson = path.join(contentDir, 'posts.json');
const rssPath = path.join(buildRoot, 'rss.xml');
const configPath = path.join(root, 'site.config.json');

function tempPathFor(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
}

async function writeFileAtomic(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = tempPathFor(filePath);
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, filePath);
}

function toPrettyDate(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function toRfc822Date(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toUTCString();
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function requireString(value, fieldName, filePath) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing or invalid "${fieldName}" in ${filePath}`);
  }
  return value.trim();
}

function parseBooleanFlag(value, fieldName, filePath, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  throw new Error(`Invalid "${fieldName}" in ${filePath}. Use true or false.`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function parseFrontMatter(content, filePath) {
  const source = content.replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) {
    throw new Error(`Missing front matter in ${filePath}`);
  }

  const end = source.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(`Unterminated front matter in ${filePath}`);
  }

  const meta = {};
  const lines = source.slice(4, end).split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const split = line.indexOf(':');
    if (split === -1) {
      throw new Error(`Invalid front matter line "${line}" in ${filePath}`);
    }

    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  return {
    meta,
    body: source.slice(end + 5).replace(/^\n+/, ''),
  };
}

function renderInline(raw) {
  const codeSnippets = [];
  const escaped = escapeHtml(raw).replace(/`([^`]+)`/g, (_m, code) => {
    const token = `__CODE_${codeSnippets.length}__`;
    codeSnippets.push(`<code>${code}</code>`);
    return token;
  });

  const withLinks = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => {
    return `<a href="${escapeAttr(href)}">${label}</a>`;
  });
  const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const withItalic = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return withItalic.replace(/__CODE_(\d+)__/g, (_m, index) => codeSnippets[Number(index)] || '');
}

function normalizeChapterTitle(title) {
  return title.replace(/^\d+\.\s+/, '').trim();
}

function parseMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const introBlocks = [];
  const chapters = [];
  const usedIds = new Set();
  let activeChapter = null;
  let subsectionStack = [];

  function uniqueId(prefix, text, fallback) {
    const base = `${prefix}-${slugify(text) || fallback}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    usedIds.add(id);
    return id;
  }

  function pushBlock(block) {
    if (activeChapter) {
      activeChapter.blocks.push(block);
    } else {
      introBlocks.push(block);
    }
  }

  function isBoundary(line) {
    return (
      /^#{1,6}\s+/.test(line) ||
      /^-\s+/.test(line) ||
      /^\d+\.\s+/.test(line) ||
      /^>\s?/.test(line) ||
      /^```/.test(line)
    );
  }

  for (let i = 0; i < lines.length; ) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();

      if (level === 2) {
        const title = normalizeChapterTitle(text);
        const chapter = {
          title,
          id: uniqueId(`chapter-${chapters.length + 1}`, title, String(chapters.length + 1)),
          blocks: [],
          subsections: [],
        };
        chapters.push(chapter);
        activeChapter = chapter;
        subsectionStack = [];
      } else {
        const id = uniqueId('section', text, String(i + 1));
        if (activeChapter && level >= 3) {
          const subsection = { id, level, title: text, children: [] };
          while (subsectionStack.length && subsectionStack[subsectionStack.length - 1].level >= level) {
            subsectionStack.pop();
          }

          const parent = subsectionStack[subsectionStack.length - 1];
          if (parent) {
            parent.children.push(subsection);
          } else {
            activeChapter.subsections.push(subsection);
          }
          subsectionStack.push(subsection);
        }
        pushBlock({ type: 'heading', level, text, id });
      }

      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim().toLowerCase();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^```/.test(lines[i].trim())) {
        i += 1;
      }
      pushBlock({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s+/, ''));
        i += 1;
      }
      pushBlock({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      pushBlock({ type: 'ol', items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      pushBlock({ type: 'blockquote', text: quoteLines.join(' ') });
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (i < lines.length) {
      const current = lines[i].trim();
      if (!current) {
        i += 1;
        break;
      }
      if (isBoundary(current)) break;
      paragraph.push(current);
      i += 1;
    }
    pushBlock({ type: 'p', text: paragraph.join(' ') });
  }

  return { introBlocks, chapters };
}

function renderBlock(block) {
  if (block.type === 'p') {
    return `<p>${renderInline(block.text)}</p>`;
  }
  if (block.type === 'heading') {
    const level = Math.min(Math.max(block.level, 1), 4);
    return `<h${level} id="${escapeAttr(block.id)}">${renderInline(block.text)}</h${level}>`;
  }
  if (block.type === 'ul') {
    const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  if (block.type === 'ol') {
    const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join('');
    return `<ol>${items}</ol>`;
  }
  if (block.type === 'blockquote') {
    return `<blockquote><p>${renderInline(block.text)}</p></blockquote>`;
  }
  if (block.type === 'code') {
    const langClass = block.lang ? ` class="language-${escapeAttr(block.lang)}"` : '';
    return `<pre><code${langClass}>${escapeHtml(block.code)}</code></pre>`;
  }
  return '';
}

function buildPostHtml(post, config, markdown) {
  const parsed = parseMarkdown(markdown);
  const introHtml = parsed.introBlocks.map(renderBlock).join('\n          ');

  const chapterHtml = parsed.chapters
    .map((chapter, index) => {
      const blocksHtml = chapter.blocks.map(renderBlock).join('\n            ');
      const chapterHeading = post.numberChapters ? `${index + 1}. ${renderInline(chapter.title)}` : renderInline(chapter.title);
      return [
        `          <section id="${escapeAttr(chapter.id)}" class="chapter">`,
        `            <h2>${chapterHeading}</h2>`,
        blocksHtml ? `            ${blocksHtml}` : '',
        '          </section>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  function renderTocSubsections(nodes, depth) {
    if (!nodes.length) return '';

    const lines = [];
    lines.push(`              <ol class="toc-sub depth-${depth}">`);
    nodes.forEach((node) => {
      lines.push(`                <li class="toc-sub-item level-${Math.min(node.level, 6)}">`);
      lines.push(`                  <a href="#${escapeAttr(node.id)}">${renderInline(node.title)}</a>`);
      if (node.children.length) {
        lines.push(renderTocSubsections(node.children, depth + 1));
      }
      lines.push('                </li>');
    });
    lines.push('              </ol>');
    return lines.join('\n');
  }

  const tocHtml = parsed.chapters.length
    ? parsed.chapters
        .map((chapter, index) => {
          const subsections = renderTocSubsections(chapter.subsections, 1);
          const chapterLabel = post.numberChapters
            ? `${index + 1}. ${renderInline(chapter.title)}`
            : renderInline(chapter.title);

          return [
            '            <li>',
            `              <a href="#${escapeAttr(chapter.id)}">${chapterLabel}</a>`,
            subsections,
            '            </li>',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n')
    : '            <li><a href="#">No chapters</a></li>';

  const tocAsideHtml = post.showContents
    ? `
        <aside class="toc open" aria-label="Table of contents">
          <button class="toc-toggle" type="button" aria-expanded="true" aria-controls="toc-list" aria-label="Toggle contents">
            <span class="toc-toggle-icon" aria-hidden="true"></span>
          </button>
          <div class="toc-panel" id="toc-list">
            <h2>Contents</h2>
            <ol class="toc-list">
${tocHtml}
            </ol>
          </div>
        </aside>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(post.title)} | ${escapeHtml(config.siteTitle || 'Site')}</title>
    <meta
      name="description"
      content="${escapeAttr(post.description || '')}"
    />
    <meta name="color-scheme" content="light dark" />
    <script>
      (function () {
        var theme = 'light';
        try {
          var saved = localStorage.getItem('theme');
          if (saved === 'light' || saved === 'dark') {
            theme = saved;
          } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            theme = 'dark';
          }
        } catch (_error) {}
        var root = document.documentElement;
        root.setAttribute('data-theme', theme);
        root.style.backgroundColor = theme === 'dark' ? '#151515' : '#f2f0e8';
        root.style.colorScheme = theme;
      })();
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500;6..72,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="../../styles.css" />
  </head>
  <body class="page-essay">
    <div class="grain" aria-hidden="true"></div>
    <div class="essay-shell">
      <header class="essay-header">
        <div class="essay-meta-row">
          <a class="home-link" href="../../">${escapeHtml(config.siteTitle || 'Home')}</a>
          <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle color theme" aria-pressed="false"></button>
        </div>
        <h1>${renderInline(post.title)}</h1>
        <p class="dek">${renderInline(post.description || '')}</p>
        <p class="meta">${escapeHtml(post.prettyDate)}</p>
      </header>

      <div class="essay-layout">
${tocAsideHtml}

        <article class="essay-content">
          ${introHtml}

${chapterHtml}
        </article>
      </div>
    </div>
    <script src="../../theme.js" defer></script>
    <script src="../../script.js" defer></script>
  </body>
</html>
`;
}

async function collectPosts(config) {
  const posts = [];
  const seenUrlPaths = new Set();

  let categoryDirs = [];
  try {
    categoryDirs = await fs.readdir(categoriesRoot, { withFileTypes: true });
  } catch {
    return posts;
  }

  for (const categoryDir of categoryDirs) {
    if (!categoryDir.isDirectory()) continue;

    const categorySlug = categoryDir.name;
    const categoryPath = path.join(categoriesRoot, categorySlug);
    const postDirs = await fs.readdir(categoryPath, { withFileTypes: true });

    for (const postDir of postDirs) {
      if (!postDir.isDirectory()) continue;

      const slug = postDir.name;
      const postFolder = path.join(categoryPath, slug);
      const markdownPath = path.join(postFolder, 'content.md');
      const outputFolder = path.join(buildRoot, categorySlug, slug);
      const htmlPath = path.join(outputFolder, 'index.html');

      let contentRaw = '';
      try {
        contentRaw = await fs.readFile(markdownPath, 'utf8');
      } catch {
        continue;
      }

      const { meta, body } = parseFrontMatter(contentRaw, markdownPath);
      const title = requireString(meta.title, 'title', markdownPath);
      const description = requireString(meta.description, 'description', markdownPath);
      const category = requireString(meta.category || categorySlug, 'category', markdownPath);
      const date = requireString(meta.date, 'date', markdownPath);
      const numberChapters = parseBooleanFlag(meta.numberChapters, 'numberChapters', markdownPath, false);
      const showContents = parseBooleanFlag(meta.showContents, 'showContents', markdownPath, true);

      if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new Error(`Invalid date "${date}" in ${markdownPath}`);
      }

      const post = {
        title,
        date,
        prettyDate: toPrettyDate(date),
        description,
        category,
        categorySlug,
        slug,
        urlPath: `${categorySlug}/${slug}/`,
        numberChapters,
        showContents,
      };

      if (seenUrlPaths.has(post.urlPath)) {
        throw new Error(`Duplicate generated URL path "${post.urlPath}"`);
      }
      seenUrlPaths.add(post.urlPath);

      const html = buildPostHtml(post, config, body);
      await fs.mkdir(outputFolder, { recursive: true });
      await writeFileAtomic(htmlPath, html);

      posts.push(post);
    }
  }

  posts.sort((a, b) => new Date(`${b.date}T00:00:00Z`) - new Date(`${a.date}T00:00:00Z`));
  return posts;
}

async function copyIfExists(source, destination) {
  try {
    const content = await fs.readFile(source);
    await writeFileAtomic(destination, content);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function copyStaticAssets() {
  const required = ['index.html', 'index.js', 'script.js', 'styles.css', 'theme.js'];
  await Promise.all(
    required.map(async (file) => {
      await copyIfExists(path.join(root, file), path.join(buildRoot, file));
    })
  );

  await copyIfExists(path.join(root, '.nojekyll'), path.join(buildRoot, '.nojekyll'));
  await copyIfExists(path.join(root, 'CNAME'), path.join(buildRoot, 'CNAME'));
}

function renderRss(config, posts) {
  const siteUrl = (config.siteUrl || '').replace(/\/$/, '');
  const items = posts
    .map((post) => {
      const link = `${siteUrl}/${post.urlPath}`;
      return [
        '    <item>',
        `      <title>${xmlEscape(post.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid>${xmlEscape(link)}</guid>`,
        `      <pubDate>${xmlEscape(toRfc822Date(post.date))}</pubDate>`,
        `      <description>${xmlEscape(post.description)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${xmlEscape(config.siteTitle || 'Site')}</title>`,
    `    <link>${xmlEscape(`${siteUrl}/`)}</link>`,
    `    <description>${xmlEscape(config.siteDescription || '')}</description>`,
    '    <language>en-us</language>',
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

async function main() {
  await fs.mkdir(buildRoot, { recursive: true });

  const config = await readJson(configPath);
  await copyStaticAssets();
  const posts = await collectPosts(config);

  await fs.mkdir(contentDir, { recursive: true });
  await writeFileAtomic(outputJson, `${JSON.stringify(posts, null, 2)}\n`);
  await writeFileAtomic(rssPath, renderRss(config, posts));

  console.log(`Generated ${posts.length} post(s) to build/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
