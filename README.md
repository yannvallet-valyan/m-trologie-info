# Métrologie Info

Site statique ultra léger (zéro JavaScript, zéro dépendance, CSS inline) : une page de présentation + des articles de blog sur la métrologie. Il met en avant **B-Métrologie** et **BMesure**.

## Utilisation

```bash
npm run build   # génère dist/
npm run serve   # build + serveur local sur http://localhost:8080
```

## Configuration

Éditez `site.config.json` : nom, **url du domaine** (`SITE_URL` peut aussi surcharger), adresses et textes de B-Métrologie / BMesure.

## Ajouter un article

Créez `content/articles/mon-sujet.md` avec le front matter :

```
---
title: Titre
description: Résumé de 150 caractères environ
date: 2026-11-10
category: Étalonnage
related: slug-autre-article,slug-autre-article
---
```

Une section `## Questions fréquentes` avec des `### Question` génère automatiquement le balisage FAQPage (schema.org).

## SEO et IA générés automatiquement

Balises canonical / Open Graph, JSON-LD (WebSite, Organization, Article, BreadcrumbList, FAQPage), `sitemap.xml`, `rss.xml`, `robots.txt` (crawlers IA autorisés), `llms.txt`, `llms-full.txt` et une version `.md` de chaque article.

## Déploiement

Publiez le dossier `dist/` sur Cloudflare Pages, Netlify, Vercel ou GitHub Pages (commande : `npm run build`).
