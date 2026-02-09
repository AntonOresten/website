import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const buildRoot = path.join(root, 'build');
const categoriesRoot = path.join(root, 'categories');
const categoriesConfigPath = path.join(root, 'categories.config.json');
const contentDir = path.join(buildRoot, 'content');
const outputJson = path.join(contentDir, 'posts.json');
const rssPath = path.join(buildRoot, 'rss.xml');
const configPath = path.join(root, 'site.config.json');

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

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

async function readCategoriesConfig() {
  const raw = await readJson(categoriesConfigPath);
  const items = Array.isArray(raw.categories) ? raw.categories : null;
  if (!items || !items.length) {
    throw new Error('categories.config.json must include a non-empty "categories" array.');
  }

  const seen = new Set();
  return items.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid category entry at index ${index} in categories.config.json`);
    }

    const slug = requireString(entry.slug, `categories[${index}].slug`, categoriesConfigPath);
    const name = requireString(entry.name, `categories[${index}].name`, categoriesConfigPath);

    if (seen.has(slug)) {
      throw new Error(`Duplicate category slug "${slug}" in categories.config.json`);
    }
    seen.add(slug);

    return {
      slug,
      name,
      order: index,
    };
  });
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

function normalizeChapterTitle(title) {
  return String(title || '').replace(/^\d+\.\s+/, '').trim();
}

function renderInlineMarkdown(text) {
  return md.renderInline(String(text || ''));
}

function buildMarkdownStructure(source) {
  const tokens = md.parse(source.replace(/\r\n/g, '\n'), {});
  const usedIds = new Set();

  function uniqueId(prefix, text, fallback) {
    const base = `${prefix}-${slugify(text || '') || fallback}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    usedIds.add(id);
    return id;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;

    const inline = tokens[i + 1];
    if (!inline || inline.type !== 'inline') continue;

    const level = Number(token.tag.slice(1));
    const headingText = normalizeChapterTitle(inline.content || '');
    const id = uniqueId(level === 2 ? 'chapter' : 'section', headingText || inline.content, String(i + 1));
    token.attrSet('id', id);
  }

  const introTokens = [];
  const chapters = [];
  let activeChapter = null;
  let subsectionStack = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === 'heading_open' && token.tag === 'h2') {
      const inline = tokens[i + 1];
      const headingTitle = normalizeChapterTitle(inline && inline.type === 'inline' ? inline.content : '');
      const id = token.attrGet('id') || uniqueId('chapter', headingTitle, String(chapters.length + 1));

      const chapter = {
        title: headingTitle,
        id,
        contentTokens: [],
        subsections: [],
      };

      chapters.push(chapter);
      activeChapter = chapter;
      subsectionStack = [];

      // Skip the h2 open/inline/close tokens; chapter heading is rendered separately.
      i += 2;
      continue;
    }

    if (!activeChapter) {
      introTokens.push(token);
      continue;
    }

    activeChapter.contentTokens.push(token);

    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1));
      if (level >= 3) {
        const inline = tokens[i + 1];
        if (inline && inline.type === 'inline') {
          const id = token.attrGet('id') || uniqueId('section', inline.content || '', String(i + 1));
          token.attrSet('id', id);

          const subsection = {
            id,
            level,
            title: inline.content,
            children: [],
          };

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
      }
    }
  }

  return {
    introHtml: md.renderer.render(introTokens, md.options, {}).trim(),
    chapters: chapters.map((chapter) => ({
      title: chapter.title,
      id: chapter.id,
      subsections: chapter.subsections,
      html: md.renderer.render(chapter.contentTokens, md.options, {}).trim(),
    })),
  };
}

function buildPostHtml(post, config, markdownSource) {
  const parsed = buildMarkdownStructure(markdownSource);

  const chapterHtml = parsed.chapters
    .map((chapter, index) => {
      const chapterHeading = post.numberChapters
        ? `${index + 1}. ${renderInlineMarkdown(chapter.title)}`
        : renderInlineMarkdown(chapter.title);

      return [
        `          <section id="${escapeAttr(chapter.id)}" class="chapter">`,
        `            <h2>${chapterHeading}</h2>`,
        chapter.html ? `            ${chapter.html}` : '',
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
      lines.push(`                  <a href="#${escapeAttr(node.id)}">${renderInlineMarkdown(node.title)}</a>`);
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
            ? `${index + 1}. ${renderInlineMarkdown(chapter.title)}`
            : renderInlineMarkdown(chapter.title);

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
        <h1>${renderInlineMarkdown(post.title)}</h1>
        <p class="dek">${renderInlineMarkdown(post.description || '')}</p>
        <p class="meta">${escapeHtml(post.prettyDate)}</p>
      </header>

      <div class="essay-layout">
${tocAsideHtml}

        <article class="essay-content">
          ${parsed.introHtml}

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

async function collectPosts(config, categoriesConfig) {
  const posts = [];
  const seenUrlPaths = new Set();

  for (const categoryConfig of categoriesConfig) {
    const categorySlug = categoryConfig.slug;
    const categoryPath = path.join(categoriesRoot, categorySlug);
    let postDirs = [];
    try {
      postDirs = await fs.readdir(categoryPath, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`Category directory is missing: ${categoryPath}`);
      }
      throw error;
    }

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
        category: categoryConfig.name,
        categorySlug,
        categoryOrder: categoryConfig.order,
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
      await copyPostAttachments(postFolder, outputFolder);
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

async function copyPostAttachments(postFolder, outputFolder) {
  const entries = await fs.readdir(postFolder, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'content.md' || entry.name === '.DS_Store') return;

      const source = path.join(postFolder, entry.name);
      const destination = path.join(outputFolder, entry.name);
      await fs.cp(source, destination, { recursive: true, force: true });
    })
  );
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
  const categoriesConfig = await readCategoriesConfig();
  await copyStaticAssets();
  const posts = await collectPosts(config, categoriesConfig);

  await fs.mkdir(contentDir, { recursive: true });
  await writeFileAtomic(outputJson, `${JSON.stringify(posts, null, 2)}\n`);
  await writeFileAtomic(rssPath, renderRss(config, posts));

  console.log(`Generated ${posts.length} post(s) to build/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
