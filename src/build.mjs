// Générateur de site statique sans dépendance. Usage : node src/build.mjs
import { readFile, writeFile, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';

const cfg = JSON.parse(await readFile('site.config.json', 'utf8'));
const BASE = (process.env.SITE_URL || cfg.url).replace(/\/$/, '');
const OUT = 'dist';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// ---------- Markdown minimal ----------
function inline(t) {
  t = esc(t);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, a, u) => `<a href="${u}">${a}</a>`);
  return t;
}

function md(src) {
  const lines = src.split('\n');
  const html = [], toc = [], faq = [];
  let i = 0, inFaq = false, curQ = null;
  const flushFaq = () => { curQ = null; };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{2,3}) (.+)/))) {
      const lvl = m[1].length, text = m[2].trim(), id = slugify(text);
      if (lvl === 2) { inFaq = /^(faq|questions fr)/i.test(text); flushFaq(); toc.push({ id, text }); }
      if (lvl === 3 && inFaq) { curQ = { q: text, a: [] }; faq.push(curQ); }
      html.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`); i++; continue;
    }
    if (/^---+$/.test(l.trim())) { html.push('<hr>'); i++; continue; }
    if (l.startsWith('> ')) {
      const b = []; while (i < lines.length && lines[i].startsWith('> ')) b.push(lines[i++].slice(2));
      html.push(`<blockquote><p>${inline(b.join(' '))}</p></blockquote>`); continue;
    }
    if (/^\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]), body = rows.slice(2).map(cells);
      html.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^([-*]|\d+\.) /.test(l)) {
      const ordered = /^\d+\./.test(l), items = [];
      while (i < lines.length && /^([-*]|\d+\.) /.test(lines[i])) items.push(lines[i++].replace(/^([-*]|\d+\.) /, ''));
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      if (curQ) curQ.a.push(items.join(' ; '));
      continue;
    }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{2,3} |\||> |- |\* |\d+\. |---)/.test(lines[i])) p.push(lines[i++]);
    html.push(`<p>${inline(p.join(' '))}</p>`);
    if (curQ) curQ.a.push(p.join(' '));
  }
  return { html: html.join('\n'), toc, faq: faq.filter((f) => f.a.length) };
}

const stripMd = (s) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '');

// ---------- Articles ----------
async function loadArticles() {
  const files = (await readdir('content/articles')).filter((f) => f.endsWith('.md'));
  const arts = [];
  for (const f of files) {
    const raw = await readFile(join('content/articles', f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`Front matter manquant : ${f}`);
    const meta = {};
    for (const line of m[1].split('\n')) { const k = line.match(/^(\w+):\s*(.*)$/); if (k) meta[k[1]] = k[2].replace(/^"|"$/g, ''); }
    for (const req of ['title', 'description', 'date', 'category']) if (!meta[req]) throw new Error(`${f}: champ "${req}" manquant`);
    const body = m[2].trim();
    const r = md(body);
    const words = stripMd(body).split(/\s+/).length;
    arts.push({ ...meta, slug: meta.slug || f.replace(/\.md$/, ''), body, ...r, minutes: Math.max(1, Math.round(words / 200)), related: (meta.related || '').split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return arts.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Gabarit ----------
const css = (await readFile('src/style.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const orgLd = { '@type': 'Organization', '@id': `${BASE}/#org`, name: cfg.name, url: `${BASE}/`, sameAs: cfg.partners.map((p) => p.url) };

function layout({ path, title, description, body, type = 'website', jsonld = [], date, robots }) {
  const url = `${BASE}${path}`;
  const fullTitle = path === '/' ? title : `${title} | ${cfg.name}`;
  return `<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${robots || 'index,follow,max-image-preview:large,max-snippet:-1'}">
<meta name="theme-color" content="#0b3d91">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:locale" content="${cfg.locale}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${BASE}/rss.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b3d91'/%3E%3Cpath d='M6 22h20M9 22v-5M13 22v-8M17 22v-5M21 22v-8M25 22v-5' stroke='%23fff' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E">
<style>${css}</style>
${jsonld.map(ld).join('\n')}
</head>
<body>
<a class="skip" href="#main">Aller au contenu</a>
<header class="hd"><div class="w">
<a class="logo" href="/">${esc(cfg.name)}</a>
<nav aria-label="Navigation principale"><a href="/"${path === '/' ? ' aria-current="page"' : ''}>Présentation</a><a href="/blog/"${path.startsWith('/blog') ? ' aria-current="page"' : ''}>Articles</a></nav>
</div></header>
<main id="main" class="w">
${body}
</main>
<footer class="ft"><div class="w">
<p><strong>${esc(cfg.name)}</strong> – ${esc(cfg.tagline)}</p>
<p>Nos sites : ${cfg.partners.map((p) => `<a href="${p.url}">${esc(p.name)}</a>`).join(' · ')}</p>
<p><a href="/blog/">Tous les articles</a> · <a href="/rss.xml">RSS</a> · <a href="/sitemap.xml">Plan du site</a> · <a href="/llms.txt">llms.txt</a></p>
</div></footer>
</body>
</html>`;
}

const partnersBox = (heading = 'Passez de la théorie à la pratique') => `<aside class="cta" aria-label="Nos services">
<h2>${heading}</h2>
<div class="cards">${cfg.partners.map((p) => `<a class="card" href="${p.url}"><strong>${esc(p.name)} →</strong><span>${esc(p.text)}</span></a>`).join('')}</div>
</aside>`;

const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${BASE}${path}` })) });

// ---------- Pages ----------
function homePage(arts) {
  const faq = [
    ['Qu\'est-ce que la métrologie ?', 'La métrologie est la science de la mesure et de ses applications. Elle garantit que les mesures sont justes, comparables et reconnues, quel que soit le lieu ou l\'instrument.'],
    ['À quoi sert un étalonnage ?', 'Un étalonnage compare un instrument à un étalon raccordé au SI et établit son écart avec une incertitude associée. Il permet de savoir si l\'instrument est apte à l\'usage prévu.'],
    ['À qui s\'adresse ce site ?', 'Aux responsables qualité, techniciens, ingénieurs, laboratoires et étudiants qui souhaitent comprendre et appliquer la métrologie simplement.'],
  ];
  const body = `<section class="hero">
<h1>La métrologie expliquée simplement</h1>
<p class="lead">${esc(cfg.name)} est un guide francophone gratuit sur la science de la mesure : <strong>étalonnage</strong>, <strong>incertitudes</strong>, <strong>traçabilité</strong>, <strong>normes ISO</strong> et <strong>unités SI</strong>. Des articles clairs, pensés pour l'industrie et les laboratoires.</p>
<p><a class="btn" href="/blog/">Lire les articles</a></p>
</section>
<section>
<h2>Qu'est-ce que la métrologie ?</h2>
<p>La <strong>métrologie</strong> est la science de la mesure et de ses applications. Elle assure que le résultat d'une mesure est <strong>fiable, comparable et traçable</strong> : un mètre mesuré à Lyon doit être le même mètre qu'à Tokyo. Sans métrologie, pas de pièces interchangeables, pas de dosage de médicaments fiable, pas d'échanges commerciaux équitables.</p>
<p>On distingue trois grands domaines : la <strong>métrologie scientifique</strong> (définition des unités et étalons primaires), la <strong>métrologie industrielle</strong> (maîtrise des instruments en production et en contrôle qualité) et la <strong>métrologie légale</strong> (instruments réglementés : balances commerciales, compteurs, pompes à carburant).</p>
</section>
<section>
<h2>Ce que vous trouverez ici</h2>
<ul class="topics">
<li><strong>Fondamentaux</strong> – vocabulaire, unités SI, principes de la mesure.</li>
<li><strong>Étalonnage et vérification</strong> – méthodes, périodicité, certificats.</li>
<li><strong>Incertitudes</strong> – comprendre et exprimer la qualité d'une mesure.</li>
<li><strong>Normes et accréditation</strong> – ISO/IEC 17025, ISO 10012, COFRAC.</li>
</ul>
</section>
<section>
<h2>Derniers articles</h2>
<ul class="list">${arts.slice(0, 6).map(articleItem).join('')}</ul>
<p><a href="/blog/">Voir tous les articles →</a></p>
</section>
${partnersBox()}
<section>
<h2>Questions fréquentes</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}
</section>`;
  const jsonld = [{
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${BASE}/#site`, url: `${BASE}/`, name: cfg.name, description: cfg.description, inLanguage: cfg.lang, publisher: { '@id': `${BASE}/#org` } },
      orgLd,
      { '@type': 'WebPage', '@id': `${BASE}/#page`, url: `${BASE}/`, name: cfg.name, isPartOf: { '@id': `${BASE}/#site` }, about: { '@type': 'Thing', name: 'Métrologie' }, inLanguage: cfg.lang },
      { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  }];
  return layout({ path: '/', title: 'Métrologie : étalonnage, incertitudes, normes – guide complet', description: cfg.description, body, jsonld });
}

const articleItem = (a) => `<li><a href="/blog/${a.slug}/"><strong>${esc(a.title)}</strong></a><span class="meta">${esc(a.category)} · ${dateFr(a.date)} · ${a.minutes} min</span><span>${esc(a.description)}</span></li>`;

function blogIndex(arts) {
  const cats = [...new Set(arts.map((a) => a.category))];
  const body = `<h1>Articles sur la métrologie</h1>
<p class="lead">Guides pratiques sur l'étalonnage, les incertitudes de mesure, la traçabilité et les normes qualité.</p>
${cats.map((c) => `<section><h2>${esc(c)}</h2><ul class="list">${arts.filter((a) => a.category === c).map(articleItem).join('')}</ul></section>`).join('')}
${partnersBox()}`;
  return layout({
    path: '/blog/', title: 'Articles sur la métrologie', description: 'Tous nos articles sur la métrologie : étalonnage, incertitudes de mesure, traçabilité, ISO 17025, unités SI. Guides pratiques en français.', body,
    jsonld: [{ '@context': 'https://schema.org', '@graph': [
      { '@type': 'CollectionPage', name: 'Articles sur la métrologie', url: `${BASE}/blog/`, inLanguage: cfg.lang, isPartOf: { '@id': `${BASE}/#site` } },
      { '@type': 'ItemList', itemListElement: arts.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/blog/${a.slug}/`, name: a.title })) },
      crumbs([['Accueil', '/'], ['Articles', '/blog/']]),
    ] }],
  });
}

function articlePage(a, all) {
  const url = `${BASE}/blog/${a.slug}/`;
  const rel = (a.related.length ? a.related.map((s) => all.find((x) => x.slug === s)).filter(Boolean) : all.filter((x) => x.slug !== a.slug && x.category === a.category)).filter((x) => x.slug !== a.slug).slice(0, 3);
  const body = `<nav class="bc" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › <a href="/blog/">Articles</a> › <span>${esc(a.category)}</span></nav>
<article>
<header>
<h1>${esc(a.title)}</h1>
<p class="meta">${esc(a.category)} · Publié le <time datetime="${a.date}">${dateFr(a.date)}</time>${a.updated ? ` · Mis à jour le <time datetime="${a.updated}">${dateFr(a.updated)}</time>` : ''} · ${a.minutes} min de lecture</p>
<p class="lead">${esc(a.description)}</p>
</header>
${a.toc.length > 2 ? `<nav class="toc" aria-label="Sommaire"><strong>Sommaire</strong><ol>${a.toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></nav>` : ''}
${a.html}
</article>
${partnersBox()}
${rel.length ? `<section><h2>À lire aussi</h2><ul class="list">${rel.map(articleItem).join('')}</ul></section>` : ''}`;
  const graph = [
    { '@type': 'Article', '@id': `${url}#article`, headline: a.title, description: a.description, datePublished: a.date, dateModified: a.updated || a.date, inLanguage: cfg.lang, mainEntityOfPage: url, url, author: { '@type': 'Organization', name: cfg.author, url: `${BASE}/` }, publisher: { '@id': `${BASE}/#org` }, articleSection: a.category, wordCount: stripMd(a.body).split(/\s+/).length },
    orgLd,
    crumbs([['Accueil', '/'], ['Articles', '/blog/'], [a.title, `/blog/${a.slug}/`]]),
  ];
  if (a.faq.length) graph.push({ '@type': 'FAQPage', mainEntity: a.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: stripMd(f.a.join(' ')) } })) });
  return layout({ path: `/blog/${a.slug}/`, title: a.title, description: a.description, body, type: 'article', jsonld: [{ '@context': 'https://schema.org', '@graph': graph }] });
}

const notFound = () => layout({ path: '/404.html', title: 'Page introuvable', description: 'Cette page n\'existe pas.', robots: 'noindex', body: '<h1>Page introuvable</h1><p>Cette page n\'existe pas. <a href="/">Retour à l\'accueil</a> ou <a href="/blog/">tous les articles</a>.</p>' });

// ---------- Fichiers SEO / IA ----------
const sitemap = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, d]) => `<url><loc>${BASE}${p}</loc><lastmod>${d}</lastmod></url>`).join('\n')}\n</urlset>\n`;

const rss = (arts) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(cfg.name)}</title><link>${BASE}/</link><description>${esc(cfg.description)}</description><language>${cfg.lang}</language>
${arts.map((a) => `<item><title>${esc(a.title)}</title><link>${BASE}/blog/${a.slug}/</link><guid>${BASE}/blog/${a.slug}/</guid><pubDate>${new Date(a.date).toUTCString()}</pubDate><description>${esc(a.description)}</description></item>`).join('\n')}
</channel></rss>\n`;

const llms = (arts) => `# ${cfg.name}

> ${cfg.description}

Site francophone sur la métrologie, édité en lien avec ${cfg.partners.map((p) => `${p.name} (${p.url})`).join(' et ')}.

## Pages principales
- [Présentation](${BASE}/): présentation du site et de la métrologie
- [Articles](${BASE}/blog/): liste de tous les articles

## Articles
${arts.map((a) => `- [${a.title}](${BASE}/blog/${a.slug}/): ${a.description}`).join('\n')}

## Sites partenaires
${cfg.partners.map((p) => `- [${p.name}](${p.url}): ${p.text}`).join('\n')}

## Contenu complet
- [llms-full.txt](${BASE}/llms-full.txt): texte intégral de tous les articles en Markdown
`;

const llmsFull = (arts) => `# ${cfg.name} – contenu complet\n\n` + arts.map((a) => `---\n\n# ${a.title}\n\nURL: ${BASE}/blog/${a.slug}/\nCatégorie: ${a.category}\nPublié le: ${a.date}\n\n${a.body}\n`).join('\n');

const robots = `User-agent: *
Allow: /

# Crawlers IA explicitement autorisés
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /

Sitemap: ${BASE}/sitemap.xml
`;

const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cache-Control: public, max-age=3600, must-revalidate
`;

// ---------- Build ----------
const arts = await loadArticles();
await rm(OUT, { recursive: true, force: true });
const put = async (p, c) => { const f = join(OUT, p); await mkdir(join(f, '..'), { recursive: true }); await writeFile(f, c); };

await put('index.html', homePage(arts));
await put('blog/index.html', blogIndex(arts));
for (const a of arts) {
  await put(`blog/${a.slug}/index.html`, articlePage(a, arts));
  await put(`blog/${a.slug}/index.md`, `# ${a.title}\n\n${a.body}\n`);
}
await put('404.html', notFound());
const last = arts[0]?.updated || arts[0]?.date || new Date().toISOString().slice(0, 10);
await put('sitemap.xml', sitemap([['/', last], ['/blog/', last], ...arts.map((a) => [`/blog/${a.slug}/`, a.updated || a.date])]));
await put('rss.xml', rss(arts));
await put('robots.txt', robots);
await put('llms.txt', llms(arts));
await put('llms-full.txt', llmsFull(arts));
await put('_headers', headers);
console.log(`OK : ${arts.length} articles, ${arts.length + 3} pages -> ${OUT}/ (${BASE})`);
