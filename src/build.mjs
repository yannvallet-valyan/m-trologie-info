// Générateur de site statique sans dépendance. Usage : node src/build.mjs
import { readFile, writeFile, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';

const cfg = JSON.parse(await readFile('site.config.json', 'utf8'));
// Priorité : SITE_URL, puis le domaine de production Vercel (automatique), puis site.config.json
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const BASE = (process.env.SITE_URL || (vercelHost ? `https://${vercelHost}` : cfg.url)).replace(/\/$/, '');
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
// Engrenage vectoriel (trait seul) : n dents, rayon extérieur ro, rayon de pied ri
function gear(cls, n, ro, ri) {
  const s = (2 * Math.PI) / n, pt = (r, a) => `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  let d = '';
  for (let i = 0; i < n; i++) { const a = i * s; d += `${pt(ri, a)} ${pt(ro, a + s * 0.15)} ${pt(ro, a + s * 0.45)} ${pt(ri, a + s * 0.6)} `; }
  return `<svg class="gear ${cls}" viewBox="-100 -100 200 200" fill="none" stroke="currentColor" stroke-width="1.2"><polygon points="${d.trim()}"/><circle r="${(ri * 0.72).toFixed(1)}"/><circle r="${(ri * 0.28).toFixed(1)}"/><path d="M0 ${-ri * 0.72}V${-ri * 0.28}M0 ${ri * 0.72}V${ri * 0.28}M${-ri * 0.72} 0H${-ri * 0.28}M${ri * 0.72} 0H${ri * 0.28}"/></svg>`;
}
const bgLayer = `<div class="prog" aria-hidden="true"></div><div class="bg" aria-hidden="true"><i class="bgrid"></i><div class="ruler"><i></i></div>${gear('g1', 24, 98, 84)}${gear('g2', 12, 98, 82)}</div>`;

const css = (await readFile('src/style.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const orgLd = { '@type': 'Organization', '@id': `${BASE}/#org`, name: cfg.name, url: `${BASE}/`, sameAs: cfg.partners.map((p) => p.url) };

function layout({ path, title, description, body, type = 'website', jsonld = [], robots }) {
  const url = `${BASE}${path}`;
  const fullTitle = path === '/' ? title : `${title} | ${cfg.name}`;
  const p0 = cfg.partners[0];
  return `<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${robots || 'index,follow,max-image-preview:large,max-snippet:-1'}">
<meta name="theme-color" content="#c00000">
${cfg.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(cfg.googleSiteVerification)}">` : ''}
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:locale" content="${cfg.locale}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${BASE}/rss.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23c00000'/%3E%3Cpath d='M6 23h20M9 23v-6M13 23v-9M17 23v-6M21 23v-9M25 23v-6' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E">
<style>${css}</style>
${jsonld.map(ld).join('\n')}
</head>
<body>
<a class="skip" href="#main">Aller au contenu</a>
${bgLayer}
<header class="hd"><div class="w bar">
<a class="logo" href="/"><span class="mono" aria-hidden="true">MI</span>${esc(cfg.name)}</a>
<nav aria-label="Navigation principale"><a href="/"${path === '/' ? ' aria-current="page"' : ''}>Accueil</a><a href="/blog/"${path.startsWith('/blog') || path.startsWith('/rubrique') ? ' aria-current="page"' : ''}>Articles</a><a href="/glossaire/"${path === '/glossaire/' ? ' aria-current="page"' : ''}>Glossaire</a><a href="/a-propos/"${path === '/a-propos/' ? ' aria-current="page"' : ''}>À propos</a><a class="btn sm" href="${p0.url}">${esc(p0.name)} →</a></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="ft"><div class="w">
<div class="fcols">
<div><p class="logo"><span class="mono" aria-hidden="true">MI</span>${esc(cfg.name)}</p><p>${esc(cfg.tagline)}</p></div>
<div><p class="eyebrow">Explorer</p><ul><li><a href="/">Présentation</a></li><li><a href="/blog/">Tous les articles</a></li><li><a href="/glossaire/">Glossaire</a></li><li><a href="/a-propos/">À propos</a></li><li><a href="/rss.xml">Flux RSS</a></li><li><a href="/sitemap.xml">Plan du site</a></li></ul></div>
<div><p class="eyebrow">Nos sites</p><ul>${cfg.partners.map((p) => `<li><a href="${p.url}">${esc(p.name)} →</a></li>`).join('')}<li><a href="${cfg.servicesUrl}">Étalonnage COFRAC →</a></li></ul></div>
<div><p class="eyebrow">Boutique</p><ul>${cfg.categories.slice(0, 5).map((c) => `<li><a href="${c.url}">${esc(c.name)}</a></li>`).join('')}</ul></div>
</div>
</div></footer>
</body>
</html>`;
}

const partnersBox = (heading = 'Passez de la théorie à la pratique') => `<section class="band" aria-label="Nos services"><div class="w">
<p class="eyebrow">Nos services</p>
<h2>${heading}</h2>
<div class="cards two">${cfg.partners.map((p) => `<a class="pcard" href="${p.url}"><strong>${esc(p.name)}</strong><span>${esc(p.text)}</span><span class="more">Découvrir ${esc(p.name)} →</span></a>`).join('')}</div>
<p class="eyebrow chipt">Catégories populaires</p>
<ul class="chips">${cfg.categories.map((c) => `<li><a href="${c.url}">${esc(c.name)}</a></li>`).join('')}</ul>
</div></section>`;

const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${BASE}${path}` })) });

const articleItem = (a) => `<li><a class="ac" href="/blog/${a.slug}/"><span class="tag">${esc(a.category)}</span><strong>${esc(a.title)}</strong><span class="desc">${esc(a.description)}</span><span class="meta">${dateFr(a.date)} · ${a.minutes} min</span><span class="more">Lire l'article →</span></a></li>`;

// ---------- Pages ----------
const glossary = JSON.parse(await readFile('content/glossaire.json', 'utf8'));
const rubSlug = (name) => slugify(name);
const rubPath = (name) => `/rubrique/${rubSlug(name)}/`;

function homePage(arts) {
  const faq = [
    ['Qu\'est-ce que la métrologie ?', 'La métrologie est la science de la mesure et de ses applications. Elle garantit que les mesures sont justes, comparables et reconnues, quel que soit le lieu ou l\'instrument.'],
    ['À quoi sert un étalonnage ?', 'Un étalonnage compare un instrument à un étalon raccordé au SI et établit son écart avec une incertitude associée. Il permet de savoir si l\'instrument est apte à l\'usage prévu.'],
    ['À qui s\'adresse ce site ?', 'Aux responsables qualité, techniciens, ingénieurs, laboratoires et étudiants qui souhaitent comprendre et appliquer la métrologie simplement.'],
    ['Qui édite Métrologie Info ?', 'Métrologie Info est édité par l\'équipe de B MESURE, spécialiste en métrologie dimensionnelle, qui exploite aussi la boutique B Metrology.'],
  ];
  const p0 = cfg.partners[0], p1 = cfg.partners[1];
  const topics = ['Pied à coulisse', 'Micromètre', 'Rugosimètre', 'Cales étalon', 'Étalonnage', 'Incertitudes', 'Traçabilité', 'ISO/IEC 17025', 'Unités SI', 'COFRAC'];
  const strip = topics.map((t) => `<span>${t}</span>`).join('');
  const feat = arts.find((a) => a.featured === 'true') || arts[0];
  const side = arts.filter((a) => a !== feat).slice(0, 3);
  const rubs = Object.keys(cfg.rubriques);
  const cnt = (r) => arts.filter((a) => a.category === r).length;
  const bySlug = (s) => arts.find((a) => a.slug === s);
  const body = `<section class="hero"><div class="w">
<p class="badge"><i aria-hidden="true"></i>Le magazine francophone de la mesure</p>
<h1>La référence de la <em>métrologie</em>.</h1>
<p class="lead">Étalonnage, incertitudes, traçabilité, normes ISO, instruments de mesure : des guides rigoureux et lisibles, rédigés par des spécialistes de la métrologie dimensionnelle.</p>
<p class="actions"><a class="btn" href="/blog/">Explorer les guides →</a><a class="btn ghost" href="/glossaire/">Parcourir le glossaire</a></p>
</div></section>
<div class="strip" aria-hidden="true"><div class="track">${strip}${strip}</div></div>
<section class="sec"><div class="w">
<p class="eyebrow">À la une</p>
<div class="front">
<a class="lead-card" href="/blog/${feat.slug}/"><span class="tag">${esc(feat.category)}</span><strong>${esc(feat.title)}</strong><span class="desc">${esc(feat.description)}</span><span class="meta">${dateFr(feat.date)} · ${feat.minutes} min de lecture</span><span class="more">Lire le dossier →</span></a>
<ul class="side">${side.map((a) => `<li><a href="/blog/${a.slug}/"><span class="tag">${esc(a.category)}</span><strong>${esc(a.title)}</strong><span class="meta">${dateFr(a.date)} · ${a.minutes} min</span></a></li>`).join('')}</ul>
</div>
</div></section>
<section class="sec soft"><div class="w">
<p class="eyebrow">Rubriques</p>
<h2>Explorez la métrologie par <em>thème</em></h2>
<ul class="hubs">${rubs.map((r) => `<li><a class="hub" href="${rubPath(r)}"><strong>${esc(r)}</strong><span class="desc">${esc(cfg.rubriques[r].intro)}</span><span class="more">${cnt(r)} guide${cnt(r) > 1 ? 's' : ''} →</span></a></li>`).join('')}</ul>
</div></section>
<section class="sec"><div class="w">
<p class="eyebrow">Instruments</p>
<h2>Bien choisir et bien utiliser vos <em>instruments</em></h2>
<ul class="inst">${cfg.instruments.map((i) => { const a = i.article && bySlug(i.article); return `<li class="icard"><strong>${esc(i.name)}</strong><span>${esc(i.blurb)}</span><span class="links">${a ? `<a href="/blog/${a.slug}/">Lire le guide</a>` : ''}<a class="shop" href="${i.shop}">Voir en boutique →</a></span></li>`; }).join('')}</ul>
</div></section>
<section class="sec soft"><div class="w">
<p class="eyebrow">Glossaire</p>
<h2>Le vocabulaire de la métrologie, <em>expliqué</em></h2>
<p class="lead">${glossary.length} définitions claires, inspirées du VIM : étalonnage, incertitude, traçabilité, résolution, EMT…</p>
<ul class="chips light">${glossary.slice(0, 14).map((g) => `<li><a href="/glossaire/#${slugify(g.term)}">${esc(g.term)}</a></li>`).join('')}<li><a href="/glossaire/"><strong>Tout le glossaire →</strong></a></li></ul>
</div></section>
<section class="sec"><div class="w">
<p class="eyebrow">Pourquoi nous faire confiance</p>
<h2>Une expertise <em>de terrain</em></h2>
<ul class="trust">
<li><strong>25 ans+</strong><span>d'expérience en métrologie dimensionnelle chez <a href="${p1.url}">B MESURE</a></span></li>
<li><strong>20 000+</strong><span>références d'instruments sur <a href="${p0.url}">B Metrology</a> (Mahr, Tesa, Insize, Accretech)</span></li>
<li><strong>COFRAC</strong><span>étalonnages accrédités ou standard, réparation et certificats</span></li>
<li><strong>ISO · VIM · GUM</strong><span>nos guides s'appuient sur les normes et référentiels internationaux</span></li>
</ul>
<p><a href="/a-propos/">Notre démarche éditoriale →</a></p>
</div></section>
${partnersBox()}
<section class="sec"><div class="w narrow">
<p class="eyebrow">FAQ</p>
<h2>Questions <em>fréquentes</em></h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}
</div></section>`;
  const jsonld = [{
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${BASE}/#site`, url: `${BASE}/`, name: cfg.name, description: cfg.description, inLanguage: cfg.lang, publisher: { '@id': `${BASE}/#org` } },
      { ...orgLd, description: cfg.description, knowsAbout: ['Métrologie', 'Étalonnage', 'Incertitude de mesure', 'Instruments de mesure dimensionnelle', 'ISO/IEC 17025'] },
      { '@type': 'WebPage', '@id': `${BASE}/#page`, url: `${BASE}/`, name: cfg.name, isPartOf: { '@id': `${BASE}/#site` }, about: { '@type': 'Thing', name: 'Métrologie' }, inLanguage: cfg.lang },
      { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  }];
  return layout({ path: '/', title: 'Métrologie : étalonnage, incertitudes, instruments – le guide de référence', description: cfg.description, body, jsonld });
}

function glossaryPage() {
  const list = [...glossary].sort((a, b) => a.term.localeCompare(b.term, 'fr'));
  const letters = [...new Set(list.map((g) => g.term[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()))];
  const L = (g) => g.term[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const body = `<section class="hero small"><div class="w narrow">
<nav class="bc" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <span>Glossaire</span></nav>
<p class="eyebrow">Glossaire</p>
<h1>Glossaire de la <em>métrologie</em>.</h1>
<p class="lead">${list.length} termes essentiels, définis simplement et liés aux guides détaillés. Les définitions s'inspirent du Vocabulaire international de métrologie (VIM).</p>
<ul class="chips light az">${letters.map((l) => `<li><a href="#lettre-${l}">${l}</a></li>`).join('')}</ul>
</div></section>
<section class="sec"><div class="w narrow"><dl class="gl">
${letters.map((l) => `<h2 id="lettre-${l}" class="cat">${l}</h2>${list.filter((g) => L(g) === l).map((g) => `<div class="term" id="${slugify(g.term)}"><dt>${esc(g.term)}</dt><dd>${esc(g.def)}${g.article ? ` <a href="/blog/${g.article}/">Lire le guide →</a>` : ''}${g.shop ? ` <a class="shop" href="${g.shop}">${g.shop.includes('bmesure') ? 'Voir le service' : 'Voir en boutique'} →</a>` : ''}</dd></div>`).join('')}`).join('')}
</dl></div></section>
${partnersBox()}`;
  return layout({
    path: '/glossaire/', title: 'Glossaire de la métrologie : définitions', description: `Glossaire de la métrologie : ${list.length} définitions (étalonnage, incertitude, traçabilité, EMT, résolution, Ra, Rz…) avec liens vers les guides détaillés.`, body,
    jsonld: [{ '@context': 'https://schema.org', '@graph': [
      { '@type': 'DefinedTermSet', '@id': `${BASE}/glossaire/#set`, name: 'Glossaire de la métrologie', url: `${BASE}/glossaire/`, inLanguage: cfg.lang, hasDefinedTerm: list.map((g) => ({ '@type': 'DefinedTerm', name: g.term, description: g.def, url: `${BASE}/glossaire/#${slugify(g.term)}`, inDefinedTermSet: { '@id': `${BASE}/glossaire/#set` } })) },
      crumbs([['Accueil', '/'], ['Glossaire', '/glossaire/']]),
    ] }],
  });
}

function aboutPage() {
  const [p0, p1] = cfg.partners;
  const body = `<section class="hero small"><div class="w narrow">
<nav class="bc" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <span>À propos</span></nav>
<p class="eyebrow">À propos</p>
<h1>Notre démarche <em>éditoriale</em>.</h1>
<p class="lead">${esc(cfg.name)} a une ambition : devenir le site de référence francophone pour comprendre et appliquer la métrologie.</p>
</div></section>
<section class="sec"><div class="w narrow prose">
<h2>Qui sommes-nous ?</h2>
<p>${esc(cfg.name)} est édité par l'équipe de <a href="${p1.url}">${esc(p1.name)}</a>, spécialiste en métrologie dimensionnelle depuis plus de 25 ans, installé à Saint-Sorlin-en-Valloire (Drôme). Nous exploitons aussi la boutique en ligne <a href="${p0.url}">${esc(p0.name)}</a>, qui distribue des instruments de mesure Mahr, Tesa, Insize et Accretech.</p>
<h2>Transparence</h2>
<p>Ce site est édité par des acteurs de la métrologie. Nous mentionnons nos services et notre boutique lorsque ces liens sont utiles au lecteur : <a href="${p0.url}">${esc(p0.name)}</a> pour acheter un instrument, <a href="${cfg.servicesUrl}">${esc(p1.name)}</a> pour l'étalonnage ou la réparation. Les guides eux-mêmes restent gratuits et neutres sur les marques.</p>
<h2>Nos sources</h2>
<ul>
<li>Vocabulaire international de métrologie, VIM (JCGM 200)</li>
<li>Guide pour l'expression de l'incertitude de mesure, GUM (JCGM 100)</li>
<li>ISO/IEC 17025 et ISO 10012</li>
<li>Normes d'instruments : ISO 13385-1 (pied à coulisse), ISO 3650 (cales étalon), série ISO 21920 (rugosité)</li>
<li>Brochure du Bureau international des poids et mesures sur le SI</li>
</ul>
<h2>Mises à jour et corrections</h2>
<p>Chaque article affiche sa date de publication et, le cas échéant, sa date de mise à jour. Si vous repérez une erreur ou une imprécision, contactez-nous : nous la corrigeons rapidement.</p>
<h2>Nous contacter</h2>
<p>Pour une question technique, un devis d'étalonnage ou un conseil de choix d'instrument : <a href="https://b-metrology.com/contact-us/">formulaire de contact B Metrology</a> ou <a href="${p1.url}">${esc(p1.name)}</a>.</p>
</div></section>
${partnersBox()}`;
  return layout({
    path: '/a-propos/', title: 'À propos et démarche éditoriale', description: `Qui édite ${cfg.name} ? Notre équipe, nos sources (VIM, GUM, ISO), notre politique de mises à jour et notre transparence sur les liens vers B Metrology et B MESURE.`, body,
    jsonld: [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'AboutPage', name: 'À propos', url: `${BASE}/a-propos/`, inLanguage: cfg.lang, isPartOf: { '@id': `${BASE}/#site` } }, orgLd, crumbs([['Accueil', '/'], ['À propos', '/a-propos/']])] }],
  });
}

function rubriquePage(name, arts) {
  const r = cfg.rubriques[name], list = arts.filter((a) => a.category === name);
  const body = `<section class="hero small"><div class="w">
<nav class="bc" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <a href="/blog/">Articles</a> / <span>${esc(name)}</span></nav>
<p class="eyebrow">Rubrique</p>
<h1>${esc(name)}</h1>
<p class="lead">${esc(r.intro)}</p>
<p class="actions"><a class="btn" href="${r.cta.url}">${esc(r.cta.text)} →</a></p>
</div></section>
<section class="sec"><div class="w"><ul class="grid">${list.map(articleItem).join('')}</ul></div></section>
${partnersBox()}`;
  return layout({
    path: rubPath(name), title: `${name} : guides et articles`, description: `${r.intro} ${list.length} guide${list.length > 1 ? 's' : ''} pratique${list.length > 1 ? 's' : ''} sur ${cfg.name}.`, body,
    jsonld: [{ '@context': 'https://schema.org', '@graph': [
      { '@type': 'CollectionPage', name, url: `${BASE}${rubPath(name)}`, inLanguage: cfg.lang, isPartOf: { '@id': `${BASE}/#site` } },
      { '@type': 'ItemList', itemListElement: list.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/blog/${a.slug}/`, name: a.title })) },
      crumbs([['Accueil', '/'], ['Articles', '/blog/'], [name, rubPath(name)]]),
    ] }],
  });
}

function blogIndex(arts) {
  const cats = [...new Set(arts.map((a) => a.category))];
  const body = `<section class="hero small"><div class="w">
<p class="eyebrow">Articles</p>
<h1>Tout sur la <em>métrologie</em>.</h1>
<p class="lead">Guides pratiques sur l'étalonnage, les incertitudes de mesure, la traçabilité et les normes qualité.</p>
</div></section>
<section class="sec"><div class="w">
${cats.map((c) => `<h2 class="cat">${esc(c)}</h2><ul class="grid">${arts.filter((a) => a.category === c).map(articleItem).join('')}</ul>`).join('')}
</div></section>
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
  const body = `<div class="w narrow">
<nav class="bc" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <a href="/blog/">Articles</a> / <a href="${rubPath(a.category)}">${esc(a.category)}</a></nav>
<article>
<header class="ah">
<span class="tag">${esc(a.category)}</span>
<h1>${esc(a.title)}</h1>
<p class="lead">${esc(a.description)}</p>
<p class="meta">Publié le <time datetime="${a.date}">${dateFr(a.date)}</time>${a.updated ? ` · Mis à jour le <time datetime="${a.updated}">${dateFr(a.updated)}</time>` : ''} · ${a.minutes} min de lecture</p>
</header>
${a.toc.length > 2 ? `<nav class="toc" aria-label="Sommaire"><strong>Sommaire</strong><ol>${a.toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></nav>` : ''}
<div class="prose">
${a.html}
</div>
</article>
</div>
${partnersBox()}
${rel.length ? `<section class="sec soft"><div class="w"><p class="eyebrow">À lire aussi</p><ul class="grid">${rel.map(articleItem).join('')}</ul></div></section>` : ''}`;
  const graph = [
    { '@type': 'Article', '@id': `${url}#article`, headline: a.title, description: a.description, datePublished: a.date, dateModified: a.updated || a.date, inLanguage: cfg.lang, mainEntityOfPage: url, url, author: { '@type': 'Organization', name: cfg.author, url: `${BASE}/` }, publisher: { '@id': `${BASE}/#org` }, articleSection: a.category, wordCount: stripMd(a.body).split(/\s+/).length },
    orgLd,
    crumbs([['Accueil', '/'], ['Articles', '/blog/'], [a.title, `/blog/${a.slug}/`]]),
  ];
  if (a.faq.length) graph.push({ '@type': 'FAQPage', mainEntity: a.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: stripMd(f.a.join(' ')) } })) });
  return layout({ path: `/blog/${a.slug}/`, title: a.title, description: a.description, body, type: 'article', jsonld: [{ '@context': 'https://schema.org', '@graph': graph }] });
}

const notFound = () => layout({ path: '/404.html', title: 'Page introuvable', description: 'Cette page n\'existe pas.', robots: 'noindex', body: '<section class="hero small"><div class="w"><h1>Page <em>introuvable</em>.</h1><p class="lead">Cette page n\'existe pas.</p><p class="actions"><a class="btn" href="/">Retour à l\'accueil</a><a class="btn ghost" href="/blog/">Tous les articles</a></p></div></section>' });

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
- [Glossaire](${BASE}/glossaire/): définitions des termes de métrologie
- [À propos](${BASE}/a-propos/): démarche éditoriale et sources

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
await put('glossaire/index.html', glossaryPage());
await put('a-propos/index.html', aboutPage());
for (const r of Object.keys(cfg.rubriques)) await put(`rubrique/${rubSlug(r)}/index.html`, rubriquePage(r, arts));
await put('404.html', notFound());
const last = arts[0]?.updated || arts[0]?.date || new Date().toISOString().slice(0, 10);
await put('sitemap.xml', sitemap([['/', last], ['/blog/', last], ['/glossaire/', last], ['/a-propos/', last], ...Object.keys(cfg.rubriques).map((r) => [rubPath(r), last]), ...arts.map((a) => [`/blog/${a.slug}/`, a.updated || a.date])]));
await put('rss.xml', rss(arts));
await put('robots.txt', robots);
await put('llms.txt', llms(arts));
await put('llms-full.txt', llmsFull(arts));
await put('_headers', headers);
// Fichiers statiques copiés tels quels (vérification Google Search Console, etc.)
await cp('public', OUT, { recursive: true }).catch(() => {});
console.log(`OK : ${arts.length} articles, ${arts.length + 3} pages -> ${OUT}/ (${BASE})`);
