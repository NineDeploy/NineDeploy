/** A one-click deploy template. Lives in the repo so the hub is self-hosted. */
export interface Template {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  emoji: string;
  image: string;
  port: number;
  volumeMount?: string;
  env?: Array<{ key: string; value: string; secret?: boolean }>;
  website?: string;
  docs?: string;
  featured?: boolean;
}

export const TEMPLATES: Template[] = [
  // ── Existing ──────────────────────────────────────────────────────────
  { id: 'n8n', name: 'n8n', tagline: 'Fair-code workflow automation', description: 'n8n is an extendable workflow automation tool. Connect anything to everything via a node-based editor and run self-hosted workflows, integrations and automations with full control over your data.', category: 'Automation', emoji: '🔗', image: 'n8nio/n8n', port: 5678, volumeMount: '/home/node/.n8n', website: 'https://n8n.io', featured: true },
  { id: 'uptime-kuma', name: 'Uptime Kuma', tagline: 'A fancy self-hosted monitoring tool', description: 'Monitor HTTP(s), TCP, DNS, Docker and more with status pages, notifications and beautiful uptime charts.', category: 'Monitoring', emoji: '📊', image: 'louislam/uptime-kuma:1', port: 3001, volumeMount: '/app/data', website: 'https://github.com/louislam/uptime-kuma', featured: true },
  { id: 'grafana', name: 'Grafana', tagline: 'Dashboards & observability', description: 'Query, visualize and alert on metrics, logs and traces from any data source.', category: 'Monitoring', emoji: '📈', image: 'grafana/grafana', port: 3000, volumeMount: '/var/lib/grafana', env: [{ key: 'GF_SECURITY_ADMIN_PASSWORD', value: 'admin', secret: true }], website: 'https://grafana.com' },
  { id: 'vaultwarden', name: 'Vaultwarden', tagline: 'Self-hosted password manager', description: 'An unofficial, lightweight Bitwarden-compatible server written in Rust.', category: 'Security', emoji: '🔐', image: 'vaultwarden/server:latest', port: 8222, volumeMount: '/data', env: [{ key: 'ROCKET_PORT', value: '8222' }], website: 'https://github.com/dani-garcia/vaultwarden', featured: true },
  { id: 'adminer', name: 'Adminer', tagline: 'Single-file database management', description: 'A tiny PHP database client for MySQL, PostgreSQL, SQLite, MS SQL and more.', category: 'Database', emoji: '🗄️', image: 'adminer:4', port: 8080, website: 'https://www.adminer.org' },
  { id: 'redis-insight', name: 'Redis Insight', tagline: 'GUI for Redis', description: 'Visualize and explore your Redis data with an intuitive web UI.', category: 'Database', emoji: '🔴', image: 'redis/redisinsight:latest', port: 5540, volumeMount: '/data', website: 'https://redis.com/redis-enterprise/redis-insight' },
  { id: 'libretranslate', name: 'LibreTranslate', tagline: 'Self-hosted machine translation', description: 'A free, open-source machine translation API you can run entirely on your own infrastructure.', category: 'AI', emoji: '🌐', image: 'libretranslate/libretranslate:latest', port: 5000, volumeMount: '/home/libretranslate', website: 'https://libretranslate.com' },
  { id: 'memos', name: 'Memos', tagline: 'Lightweight, self-hosted memos', description: 'A fast, privacy-first note-taking service with Markdown, tags and full-text search.', category: 'Productivity', emoji: '📝', image: 'neosmemo/memos:stable', port: 5230, volumeMount: '/var/opt/memos', website: 'https://www.usememos.com', featured: true },

  // ── Media & Automation ────────────────────────────────────────────────
  { id: 'qbittorrent', name: 'qBittorrent', tagline: 'BitTorrent client with web UI', description: 'Lightweight and powerful BitTorrent client with a built-in web interface for remote management.', category: 'Media', emoji: '⬇️', image: 'linuxserver/qbittorrent', port: 8080, volumeMount: '/config', env: [{ key: 'WEBUI_PORT', value: '8080' }, { key: 'PUID', value: '1000' }, { key: 'PGID', value: '1000' }], website: 'https://www.qbittorrent.org' },
  { id: 'sonarr', name: 'Sonarr', tagline: 'Smart TV show manager', description: 'Automatically monitor, download and organize TV shows with smart renaming and metadata.', category: 'Media', emoji: '📺', image: 'linuxserver/sonarr', port: 8989, volumeMount: '/config', env: [{ key: 'PUID', value: '1000' }, { key: 'PGID', value: '1000' }], website: 'https://sonarr.tv' },
  { id: 'radarr', name: 'Radarr', tagline: 'Automated movie manager', description: 'Automatically monitor, download and organize movies with beautiful metadata management.', category: 'Media', emoji: '🎬', image: 'linuxserver/radarr', port: 7878, volumeMount: '/config', env: [{ key: 'PUID', value: '1000' }, { key: 'PGID', value: '1000' }], website: 'https://radarr.video' },
  { id: 'prowlarr', name: 'Prowlarr', tagline: 'Unified indexer manager', description: 'Manage all your indexers in one place with full *arr stack integration.', category: 'Media', emoji: '🔍', image: 'linuxserver/prowlarr', port: 9696, volumeMount: '/config', env: [{ key: 'PUID', value: '1000' }, { key: 'PGID', value: '1000' }], website: 'https://prowlarr.com' },
  { id: 'bazarr', name: 'Bazarr', tagline: 'Subtitle companion', description: 'Automatically download and manage subtitles for Sonarr and Radarr.', category: 'Media', emoji: '💬', image: 'linuxserver/bazarr', port: 6767, volumeMount: '/config', env: [{ key: 'PUID', value: '1000' }, { key: 'PGID', value: '1000' }], website: 'https://www.bazarr.media' },
  { id: 'jellyfin', name: 'Jellyfin', tagline: 'Free software media server', description: 'Stream your movies, shows, music and photos to any device. No tracking, no subscriptions.', category: 'Media', emoji: '🍿', image: 'jellyfin/jellyfin', port: 8096, volumeMount: '/config', website: 'https://jellyfin.org', featured: true },
  { id: 'plex', name: 'Plex', tagline: 'Premium media streaming', description: 'Organize and stream your media library with rich metadata and beautiful apps.', category: 'Media', emoji: '🎥', image: 'linuxserver/plex', port: 32400, volumeMount: '/config', website: 'https://www.plex.tv' },
  { id: 'overseerr', name: 'Overseerr', tagline: 'Request management for media', description: 'Let your users request movies and TV shows with a beautiful, simple interface.', category: 'Media', emoji: '🍿', image: 'ghcr.io/sct/overseerr', port: 5055, volumeMount: '/app/config', website: 'https://overseerr.dev' },

  // ── Productivity & Knowledge ──────────────────────────────────────────
  { id: 'nextcloud', name: 'Nextcloud', tagline: 'Self-hosted file sync & collaboration', description: 'A safe home for all your data — files, calendars, contacts, mail and more, with sharing and collaboration built in.', category: 'Productivity', emoji: '☁️', image: 'nextcloud', port: 80, volumeMount: '/var/www/html', website: 'https://nextcloud.com', featured: true },
  { id: 'bookstack', name: 'BookStack', tagline: 'Simple self-hosted wiki', description: 'A simple, clean platform for storing and organising information with a WYSIWYG editor.', category: 'Productivity', emoji: '📚', image: 'linuxserver/bookstack', port: 80, volumeMount: '/config', website: 'https://www.bookstackapp.com' },
  { id: 'excalidraw', name: 'Excalidraw', tagline: 'Virtual whiteboard for diagrams', description: 'A virtual, hand-drawn-style whiteboard for sketching diagrams and collaborating in real time.', category: 'Productivity', emoji: '✏️', image: 'excalidraw/excalidraw', port: 80, website: 'https://excalidraw.com' },
  { id: 'it-tools', name: 'IT-Tools', tagline: 'Handy developer utilities', description: 'A collection of handy online tools for developers — encoders, decoders, formatters, generators and more.', category: 'DevTools', emoji: '🛠️', image: 'corentinth/it-tools', port: 80, website: 'https://it-tools.tech' },
  { id: 'linkding', name: 'Linkding', tagline: 'Minimal fast bookmark manager', description: 'A lightweight, fast bookmark manager you can self-host with a clean interface.', category: 'Productivity', emoji: '🔖', image: 'sissbruecker/linkding', port: 9090, volumeMount: '/etc/linkding/data', website: 'https://github.com/sissbruecker/linkding' },
  { id: 'mealie', name: 'Mealie', tagline: 'Self-hosted recipe manager', description: 'A delicious self-hosted recipe manager and meal planner with a beautiful, responsive UI.', category: 'Productivity', emoji: '🍳', image: 'ghcr.io/mealie-recipes/mealie', port: 9000, volumeMount: '/app/data', website: 'https://mealie.io' },
  { id: 'actual-budget', name: 'Actual Budget', tagline: 'Super fast local-first budgeting', description: 'A super fast, privacy-focused budgeting app that works offline and syncs across devices.', category: 'Productivity', emoji: '💰', image: 'actualbudget/actual-server', port: 5006, volumeMount: '/data', website: 'https://actualbudget.org' },
  { id: 'stirling-pdf', name: 'Stirling-PDF', tagline: 'Powerful locally hosted PDF toolkit', description: 'A comprehensive suite of PDF tools — merge, split, convert, compress, sign and more, all locally hosted.', category: 'Productivity', emoji: '📄', image: 'stirlingtools/stirling-pdf', port: 8080, volumeMount: '/configs', website: 'https://stirlingpdf.com', featured: true },

  // ── Developer Tools ───────────────────────────────────────────────────
  { id: 'gitea', name: 'Gitea', tagline: 'Painless self-hosted Git service', description: 'A lightweight, fast self-hosted Git service with issues, pull requests, CI/CD and a built-in wiki.', category: 'DevTools', emoji: '🎯', image: 'gitea/gitea', port: 3000, volumeMount: '/data', website: 'https://gitea.io' },
  { id: 'forgejo', name: 'Forgejo', tagline: 'Lightweight Git forge', description: 'A self-hosted, lightweight software forge. A community-driven, drop-in replacement for Gitea.', category: 'DevTools', emoji: '🔥', image: 'codeberg.org/forgejo/forgejo', port: 3000, volumeMount: '/data', website: 'https://forgejo.org' },
  { id: 'code-server', name: 'Code-Server', tagline: 'VS Code in the browser', description: 'Run Visual Studio Code on any machine anywhere and access it through the browser.', category: 'DevTools', emoji: '💻', image: 'linuxserver/code-server', port: 8443, volumeMount: '/config', env: [{ key: 'PASSWORD', value: 'changeme', secret: true }], website: 'https://coder.com', featured: true },
  { id: 'dozzle', name: 'Dozzle', tagline: 'Real-time Docker log viewer', description: 'A lightweight, real-time log viewer for Docker containers. No databases, no setup — just logs.', category: 'DevTools', emoji: '📜', image: 'amir20/dozzle', port: 8080, website: 'https://dozzle.dev' },
  { id: 'dockge', name: 'Dockge', tagline: 'Compose stack manager UI', description: 'An easy-to-use, reactive Docker Compose stack manager with a beautiful web interface.', category: 'DevTools', emoji: '🐳', image: 'louislam/dockge', port: 5001, volumeMount: '/app/data', website: 'https://github.com/louislam/dockge' },

  // ── Dashboards ────────────────────────────────────────────────────────
  { id: 'homarr', name: 'Homarr', tagline: 'Sleek draggable dashboard', description: 'A sleek, modern dashboard for organizing and accessing all your services in one place.', category: 'Web', emoji: '📋', image: 'ghcr.io/ajnart/homarr:latest', port: 7575, volumeMount: '/app/data', website: 'https://homarr.dev' },
  { id: 'heimdall', name: 'Heimdall', tagline: 'Application dashboard launcher', description: 'An elegant dashboard that gives you quick access to all your web applications.', category: 'Web', emoji: '🚀', image: 'linuxserver/heimdall', port: 80, volumeMount: '/config', website: 'https://heimdall.site' },

  // ── Networking / DNS ──────────────────────────────────────────────────
  { id: 'nginx-proxy-manager', name: 'Nginx Proxy Manager', tagline: 'Reverse proxy with free SSL UI', description: 'A beautiful, simple interface for managing Nginx reverse proxies with free Let\'s Encrypt SSL.', category: 'Web', emoji: '🔀', image: 'jc21/nginx-proxy-manager', port: 81, volumeMount: '/data', website: 'https://nginxproxymanager.com' },
  { id: 'adguard-home', name: 'AdGuard Home', tagline: 'Network-wide ad blocker', description: 'A network-wide ads and trackers blocking DNS server with a clean web dashboard.', category: 'Security', emoji: '🛡️', image: 'adguard/adguardhome', port: 80, volumeMount: '/opt/adguardhome/conf', website: 'https://adguard.com/en/adguard-home/overview.html' },
  { id: 'pihole', name: 'Pi-hole', tagline: 'Black hole for advertisements', description: 'A DNS sinkhole that protects your devices from ads and trackers at the network level.', category: 'Security', emoji: '🕳️', image: 'pihole/pihole', port: 80, volumeMount: '/etc/pihole', env: [{ key: 'WEBPASSWORD', value: 'changeme', secret: true }], website: 'https://pi-hole.net' },

  // ── Analytics ─────────────────────────────────────────────────────────
  { id: 'umami', name: 'Umami', tagline: 'Simple, fast, privacy-first analytics', description: 'A simple, fast, privacy-focused alternative to Google Analytics with a clean, intuitive dashboard.', category: 'Web', emoji: '📊', image: 'ghcr.io/umami-software/umami', port: 3000, website: 'https://umami.is' },
  { id: 'metabase', name: 'Metabase', tagline: 'Open-source business intelligence', description: 'An open-source BI tool for asking questions about your data and visualizing answers.', category: 'Web', emoji: '🧠', image: 'metabase/metabase', port: 3000, volumeMount: '/metabase.db', website: 'https://www.metabase.com' },
  { id: 'meilisearch', name: 'Meilisearch', tagline: 'Lightning-fast search API', description: 'A lightning-fast search engine that fits effortlessly into your apps and websites.', category: 'Web', emoji: '⚡', image: 'getmeili/meilisearch', port: 7700, volumeMount: '/meili_data', env: [{ key: 'MEILI_MASTER_KEY', value: 'changeme-please', secret: true }], website: 'https://www.meilisearch.com' },

  // ── Storage / Backend ─────────────────────────────────────────────────
  { id: 'minio', name: 'MinIO', tagline: 'S3-compatible object storage', description: 'High-performance, S3-compatible object storage that runs anywhere — from laptop to data center.', category: 'Database', emoji: '📦', image: 'minio/minio', port: 9001, volumeMount: '/data', env: [{ key: 'MINIO_ROOT_USER', value: 'admin' }, { key: 'MINIO_ROOT_PASSWORD', value: 'changeme123', secret: true }], website: 'https://min.io', featured: true },
  { id: 'pocketbase', name: 'PocketBase', tagline: 'Backend in one binary', description: 'An open-source backend consisting of embedded database with real-time subscriptions, auth and file storage.', category: 'Database', emoji: '🗳️', image: 'ghcr.io/muchobien/pocketbase', port: 8090, volumeMount: '/pb_data', website: 'https://pocketbase.io' },
  { id: 'strapi', name: 'Strapi', tagline: 'Headless CMS for content APIs', description: 'The leading open-source headless CMS — build, manage and distribute content anywhere.', category: 'Web', emoji: '📰', image: 'strapi/strapi', port: 1337, volumeMount: '/srv/app/public/uploads', website: 'https://strapi.io' },

  // ── CMS / Publishing ──────────────────────────────────────────────────
  { id: 'ghost', name: 'Ghost', tagline: 'Independent publishing platform', description: 'A powerful platform for independent publishers and creators, with built-in memberships and newsletter support.', category: 'Web', emoji: '👻', image: 'ghost:5', port: 2368, volumeMount: '/var/lib/ghost/content', website: 'https://ghost.org' },
  { id: 'wordpress', name: 'WordPress', tagline: 'World\'s most popular website builder', description: 'The world\'s most popular CMS, powering over 40% of all websites. Themes, plugins and endless customization.', category: 'Web', emoji: '📝', image: 'wordpress', port: 80, volumeMount: '/var/www/html', website: 'https://wordpress.org' },

  // ── AI ────────────────────────────────────────────────────────────────
  { id: 'ollama', name: 'Ollama', tagline: 'Run large language models locally', description: 'Get up and running with large language models — Llama 3, Mistral, Phi-3 and more, all locally.', category: 'AI', emoji: '🧠', image: 'ollama/ollama', port: 11434, volumeMount: '/root/.ollama', website: 'https://ollama.com', featured: true },
  { id: 'open-webui', name: 'Open WebUI', tagline: 'ChatGPT-style UI for local LLMs', description: 'A beautiful, feature-rich ChatGPT-style web interface for Ollama and other LLM backends.', category: 'AI', emoji: '💬', image: 'ghcr.io/open-webui/open-webui:main', port: 8080, volumeMount: '/app/backend/data', website: 'https://github.com/open-webui/open-webui' },

  // ── Communication ─────────────────────────────────────────────────────
  { id: 'mattermost', name: 'Mattermost', tagline: 'Open-source Slack alternative', description: 'An open-source, self-hosted messaging platform for teams — secure, scalable and highly customizable.', category: 'Communication', emoji: '💬', image: 'mattermost/mattermost-team-edition', port: 8065, volumeMount: '/mattermost/data', website: 'https://mattermost.com' },

  // ── Monitoring ────────────────────────────────────────────────────────
  { id: 'prometheus', name: 'Prometheus', tagline: 'Industry-standard metrics scraping', description: 'The industry-standard open-source monitoring and alerting toolkit for metrics.', category: 'Monitoring', emoji: '🔥', image: 'prom/prometheus', port: 9090, volumeMount: '/prometheus', website: 'https://prometheus.io' },
  { id: 'loki', name: 'Loki', tagline: 'Horizontally scalable log aggregation', description: 'A horizontally scalable, highly available log aggregation system inspired by Prometheus.', category: 'Monitoring', emoji: '🌀', image: 'grafana/loki', port: 3100, volumeMount: '/loki', website: 'https://grafana.com/oss/loki' },
  { id: 'beszel', name: 'Beszel', tagline: 'Lightweight server monitoring hub', description: 'A lightweight, easy-to-use server monitoring tool with a beautiful web dashboard.', category: 'Monitoring', emoji: '📡', image: 'henrygd/beszel', port: 8090, volumeMount: '/beszel_data', website: 'https://github.com/henrygd/beszel' },

  // ── Smart Home ────────────────────────────────────────────────────────
  { id: 'home-assistant', name: 'Home Assistant', tagline: 'Open-source home automation', description: 'A powerful, open-source home automation platform that puts local control and privacy first.', category: 'Productivity', emoji: '🏠', image: 'homeassistant/home-assistant', port: 8123, volumeMount: '/config', website: 'https://www.home-assistant.io', featured: true },
];

export const TEMPLATE_CATEGORIES = ['All', ...Array.from(new Set(TEMPLATES.map((t) => t.category)))];
