# NineDeploy — Sıfır Hatalı Deploy Platformuna Dönüşüm Planı

Onaylanan tasarım kararları:
- **RBAC:** Admin-only yıkıcı/sistem-geneli işlemler; member servis oluşturup yönetebilir, kendi servislerini durdurabilir.
- **Sıfır-kesinti:** Docker = blue-green; PM2 = auto-rollback (fail'de eski runtime geri başlatılır).

Plan 5 fazdan oluşur. Her faz kendi içinde test edilebilir ve bağımsız commitlenebilir. Fazlar sıralı; her faz bir öncekine dayanır.

---

## FAZ 0 — CI Altyapısı (önkoşul; her değişiklik doğrulanmalı)

Şu an **CI yok**. Tüm testler sadece geliştirici makinesinde çalışıyor. Önce bunu kurarak sonraki fazlardaki değişikliklerin otomatik doğrulanmasını sağlayacağız.

**Değişiklikler:**
1. **`.github/workflows/ci.yml`** (yeni) — Node 20 + pnpm matrix. Adımlar: `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm build` → `pnpm test` (coverage ile). PR ve push'ta tetiklenir.
2. **`.github/workflows/release.yml`** (yeni) — tag'te Docker image build + GHCR publish (Faz 4'teki Dockerfile'a bağlanır; şimdilik iskelet).
3. **`turbo.json`** — `lint` ve `typecheck` task'larının `outputs` ve `cache` ayarlarını doğrula (zaten var, gözden geçirme).
4. **`apps/server/vitest.config.ts`** — mevcut %100 coverage gate'i koru ama **integration test'leri hariç tutacak** `include`/`exclude` mask ekle (Faz 4'te gerçek Docker testleri eklenecek).

**Doğrulama:** İlk PR'da CI yeşil çıkmalı.

---

## FAZ 1 — Deploy Güvenilirliği (en kritik)

Mevcut sorunlar: stop-old-then-start-new (kesinti), hiç timeout yok, crash'te deployment `building`'de takılı, başarılı deploy sonrası adımlar fail ederse sağlıklı container öldürülüyor, zayıf healthcheck.

### 1.1 Subprocess timeout + kill (`apps/server/src/lib/exec.ts`)
- `ExecOptions`'a opsiyonel `timeoutMs?: number` ekle (default: örn. 600.000ms = 10dk).
- `run()` ve `capture()`'da: süre dolunca `child.kill('SIGTERM)` → 5s sonra `SIGKILL` + reject(new TimeoutError). **Tree-kill** gerekli (child process'ler — örn. `sh -c` → `docker build`) için `process.kill(-child.pid)` (process group) veya `tree-kill` paketi.
- **Env izolasyonu:** `{ ...process.env, ...opts.env }` yerine **beyaz liste** yaklaşımı — sadece `PATH`, `HOME`, `LANG`, `DOCKER_BUILDKIT` gibi güvenli değişkenleri devral; `NINEDEPLOY_*`, `MASTER`, `JWT` vs. **asla** geçmesin. Yeni yardımcı: `const SAFE_ENV_KEYS = [...]`.
- Satır bölme bug'ı: chunk'lar arası yarım satır için buffer tut (partial line buffer).

### 1.2 Docker blue-green deploy (`apps/server/src/engine/builders/docker.ts`)
**Yeni strateji (zero-downtime):**
- `buildAndRun`: yeni container'ı **önce başlat** (`--name ${slug}-${deploymentId}`). Eski container'ı DURDURMA.
- Container state kontrolü: `docker inspect` ile status=`running` + `Restarting` değil mi diye bak (port yoksa bile). Mevcut `if (!runtime.port) return true` **kaldır**.
- Healthcheck `fetch`'e `AbortSignal.timeout(3000)` ekle; her döngüde container hâlâ `running` mı diye kısa `docker inspect`.
- Healthcheck başarılı olunca eski container'ı durdur → bunu **`stop()`'tan ayrı**, yeni bir `finalize()` adımı yap. Pipeline bu sırayı yönetir (1.4).
- Image digest sakla: `docker inspect --format '{{.Image}}'` ile digest al, deployment'a kaydet (rollback için).
- **Secrets:** `-e K=V` argv yerine **temp `--env-file`** (mode 0600, create→use→unlink). Böylece `ps`/`docker inspect`'te şifre görünmez.
- Port mapping fix: internal port desteği (image'in expose ettiği port != service.port ise). Şimdilik `service.port` her iki tarafta; dokümante et.

### 1.3 PM2 auto-rollback (`apps/server/src/engine/builders/pm2.ts`)
- `buildAndRun`: install/build'e **`ctx.env`** geç (build'in DB URL görebilmesi için). Build env whitelist ile.
- `script` yanlış kullanımı: `startCmd` bir shell komutuysa (`npm`, `node`, pipe içeren) → `pm2.start(startCmd.split(' ')[0], { args: ..., interpreter: 'none' })` veya `interpreter: 'bash'` + script dosyası. Komutu parse edip doğru PM2 API kullan.
- `max_memory_restart`: `service.memLimitMb` varsa `${mb}M` olarak set et (kaynak limiti).
- Fail'de rollback: buildAndRun başarısız olursa `previous` runtime varsa **geri başlat** (builder'a yeni opsiyonel `restart(previous)` veya pipeline yönetir).
- `withPm2` her saniye connect/disconnect etme: healthcheck'te tek uzun bağlantı veya `pm2.describe` daemon zaten bağlıyken.

### 1.4 Pipeline yeniden yapılandırma (`apps/server/src/engine/pipeline.ts`)
**Kritik yeniden düzenleme** — başarılı sonrası adımları try-block'tan çıkar:
```
try {
  ... build → buildAndRun(yeni, önceki'yi durdurMA) → healthcheck ...
} catch {
  // FAIL: yeni runtime'ı durdur, ÖNCEKİ runtime'ı GERİ BAŞLAT (rollback)
  await builder.stop(new).catch()
  if (previous) await builder.restart(previous).catch()   // YENİ
  await fail(...)
  return
}
// BAŞARI yolu (catch dışında):
await db.update(services)... runtimeId = yeni
await db.update(deployments)... running
// post-success adımları İZOLE try (container'ı asla öldürme):
try { wildcard domain insert } catch (log only)
try { await builder.stop(previous) } catch (log only)   // blue-green finalize
await writeDynamicConfig(db).catch(log only)
```
- `fail()` kendi try/catch'ine sarılı olmalı (DB hatası deployment'ı stuck bırakmasın).
- `runtime` undefined ama container yaratılmış olabilir: builder `buildAndRun` atomic değilse, builder'a `cleanup()` ekle.

### 1.5 Startup recovery (`apps/server/src/plugins/worker.ts`)
- Plugin init'te: `UPDATE deployments SET status='failed', finished_at=now WHERE status IN ('queued','building')` (crash sonrası temizlik).
- Claim sonucunu **doğrula**: `runDeployment` öncesi update'in etkilediği satır sayısı > 0 mu kontrol et (multi-worker güvenliği).
- `stop()`'a in-flight deploy için timeout (örn. 30s) — `await Promise.race([current, sleep(30000)])`. Child process'ler zaten Faz 1.1'de kill ediliyor.

### 1.6 Healthcheck güçlendirme
- `Builder.isHealthy` imzasına `containerState` kontrolü ekle (Docker'da `docker inspect`).
- Healthcheck config'i service bazlı: `healthCheckPath` + opsiyonel `expectedStatus` (default 200-399, `< 500` değil).
- Timeout'lar service bazlı yapılandırılabilir (buildConfig veya services kolonu). Şimdilik default'ları yükselt/koru.

### 1.7 Traefik config atomic yazım (`apps/server/src/engine/proxy.ts`)
- `writeDynamicConfig`: `writeFileSync` → **temp dosya + rename** (`dynamic.yml.tmp` → `fs.renameSync`). Atomic; Traefik yarı yazılmış config okuyamaz.
- Hostname/path sanitizasyonu: `host` ve `path` için katı whitelist regex (`[A-Za-z0-9.\-*?/_-]`); `)`, newline, backtick reddet. YAML injection kapansın.

### 1.8 Test güncellemeleri
- `apps/server/test/pipeline.test.ts` — blue-green akışını, rollback (fail'de previous restart), post-success izolasyonu, fail() hatasını test et.
- `apps/server/test/exec.test.ts` (yeni) — timeout, tree-kill, env whitelist, partial-line buffering.
- `apps/server/test/proxy.test.ts` — atomic yazım + hostname injection vektörleri.

---

## FAZ 2 — Güvenlik Sertleştirme

### 2.1 Rate limiting (`apps/server/src/app.ts` + yeni `apps/server/src/plugins/rateLimit.ts`)
- `@fastify/rate-limit` ekle (`apps/server/package.json`).
- Global: makul default (örn. 100 req/dk/IP). Auth rotalarına sıkı: `POST /v1/auth/login`, `/register`, `/setup`, `/refresh` → 10/dk/IP. Webhook `/v1/hooks/:id` → 60/dk/scope.
- Plugin olarak kayıt `app.ts`'te, `authPlugin` öncesi.

### 2.2 RBAC admin-only yıkıcı işler (`apps/server/src/plugins/auth.ts` + route'lar)
- `AuthUser`'a `role` ekle: `resolveUser` user'ın rolünü DB'den çekip doldursun (`lib/auth.ts` + `resolveUser` users join).
- Yeni decorator `requireAdmin`: pre-handler, `req.user.role !== 'admin'` → 403.
- **Admin-only rotalar** (yıkıcı/sistem-geneli): `/users` (zaten var), `/sources`, `/tunnels`, `/notifications`, `/system` (export/import/prune), `/databases` DELETE, `/volumes` DELETE, domain SSL toggle, user role change.
- **Member yapabilir:** servis CRUD (kendi), deploy trigger, env (kendi servisinde), domain (kendi servisinde), backup/restore (kendi DB'si).
- Member'ın erişeceği kaynaklarda **ownership** olmadığından (şema'da ownerId yok), Faz 1'de member tüm servislere erişebilir ama yıkıcı sistem işleri admin. Şimdilik bu kabul edilebilir; ownership Faz 3'e not düşülür.

### 2.3 JWT production guard + refresh revocation (`apps/server/src/env.ts`, `lib/jwt.ts`, `modules/auth.ts`)
- `env.ts`: production'da `NINEDEPLOY_JWT_SECRET` default'tan farklı zorunlu (`.refine` — `isProd && value === default` → hata). Aynı default/master-key üretimi uyarı versin.
- Refresh token revocation: refresh JWT'lerin `jti`'sini DB'de sakla (`refresh_tokens` tablosu veya `settings`), logout'ta iptal et. Veya daha basit: token version (user'da `tokenVersion` kolonu; logout/role-change'de increment → eski JWT'ler geçersiz). **Token version** yaklaşımı daha az tablo yükü — bunu seç.

### 2.4 Şifre/secret sızıntısını kapatma
- `engine/database.ts` backup/restore `sh -c` interpolation: **arg array'e** geç. `pg_dump`/`mysqldump` stdout'u host'ta redirect yerine `docker exec ... > file` — redirect kabuk gerektirir; bunun yerine `docker exec`'in stdout'unu Node'da yakalayıp dosyaya yaz (capture benzeri stream-to-file). Password'ü `MYSQL_PWD` env var ile ver (`-p` argüman değil). Shell injection tamamen kapanır.
- `engine/tunnel.ts`: cloudflare token'ı `--env-file` veya `-e` yerine **stdin/env-file** ile.
- `lib/git.ts`: token URL'e gömme → clone bittikten sonra `git remote set-url origin <temiz-url>` ile token'ı `.git/config`'ten temizle. SSH key'i checkout sonrası **sil** (şimdi asla silinmiyor). `StrictHostKeyChecking=no` → en azından `accept-new` (ilk bağlantıda kaydet, sonradan doğrula) veya known_hosts dosyası.
- CORS: `origin: true` → `publicUrl`'den türetilmiş izinli origin listesi + env override.

### 2.5 Input validation standardizasyonu (Zod her yere)
- Manuel `as {...}` cast'leri Zod şemalarına çevir: `modules/users.ts` (role patch), `modules/hooks.ts` (webhook create), `modules/sources.ts` (patch), `modules/notifications.ts` (channel CRUD). Şemalar `packages/schemas/src/`'e eklensin.
- `req.params` sayısal id'leri Zod `coerce.number().int().positive()` ile doğrula (NaN avı).

### 2.6 Testler
- `apps/server/test/rateLimit.test.ts`, `rbac.test.ts`, `jwt-prod-guard.test.ts`, env-file secret masking testi, `git.ts` cleanup testi.

---

## FAZ 3 — Veri Doğruluğu & Performans

### 3.1 Şema bug fix + indexler (`packages/db/src/schema.ts` + yeni migration)
- **BUG:** `api_tokens_user_idx` `uniqueIndex` → **`index`** (kullanıcı başına 1 token sınırı kalkar). Yeni migration `0009_`.
- **Index ekle:**
  - `metrics` → `(service_id, kind, ts)` composite index (en yüksek etkili).
  - `deployments` → `status` index (worker poll her 2sn).
  - `audit_log` → `(entity, ts)` veya en az `(ts)`.
  - `backups` → `(database_id, status)`.
  - `notification_log` → `(channel_id, ts)`.
  - `domains` → `service_id`.
- **`PRAGMA foreign_keys = ON`** (`packages/db/src/client.ts`): `createDb`'de client'a `pragma('foreign_keys = true')` ekle (libSQL'de her bağlantıda). Cascade'ler artık çalışır.
- Migration `0008`'deki gereksiz duplicate `tunnels_slug` index'ini temizle (opsiyonel).

### 3.2 Traefik routing sıfır-kesinti uyumu
- Faz 1.2 blue-green ile uyumlu: `writeDynamicConfig` artık yeni container adına işaret ediyor; eski container routing flip'e kadar hizmet veriyor. pipeline sırası (1.4) bunu garantiyor.

### 3.3 Token version / refresh revocation şeması
- `users` tablosuna `token_version integer default 0` kolonu (migration).
- JWT claim'e `ver` ekle; `resolveUser` user'ın token_version'ı ile karşılaştır.

### 3.4 Testler
- `packages/db`'ye migration testi (şema sqlite'ta açılıp FK pragma çalışıyor mu), index varlığı assert'i.

---

## FAZ 4 — Test Derinliği & Operasyonel Kalite

### 4.1 Gerçek integration testleri (testcontainers)
- `apps/server/test/integration/` (yeni) — `@testcontainers/node` ile **gerçek Docker**: bir container build + run + healthcheck + stop akışı (Faz 1.2'nin gerçekten çalıştığını doğrular). Bu testler yavaş, `vitest`项目中 ayrı project/timeout ile işaretle, CI'da opsiyonel (env flag `RUN_INTEGRATION=1`).
- Gerçek PostgreSQL/Redis container ile backup/restore akışı (database.ts Faz 2.4 değişikliklerini doğrular).

### 4.2 Frontend testleri (`apps/web`)
- Öncelik: `lib/auth.tsx` (login/logout/refresh akışı), `lib/api.ts` (SDK), `DeployWizard.tsx` (multistep akış), `ServiceDetail.tsx` (lifecycle + logs). Testing Library + jsdom (config zaten var).
- `apps/web/vitest.config.ts` threshold'u şimdilik düşük tut (örn. %20), src büyüdükçe yükselt.

### 4.3 CLI testleri (`apps/cli`)
- `apps/cli/test/` — command parsing, login flow (mock client).

### 4.4 Operasyonel cleanup
- **Docker image prune:** deploy başarılı + yeni healthcheck geçince eski image tag'lerini tut (rollback için son N), gerisini `docker image prune` (worker'da veya periyodik).
- **Log rotation:** `engine/logs.ts` — deploy log dosyalarını max boyut/yaş ile sınırla (örn. 30 gün).
- **SSH key cleanup:** git checkout sonrası key sil (Faz 2.4).
- **DB retention:** `audit_log`, `metrics`, `notification_log` için periyodik silme (collector'a benzer plugin veya mevcut collector'a ekle).

### 4.5 Dockerfile + docker-compose (geliştirme/üretim)
- Köke `Dockerfile` (multi-stage: build server+web → runtime slim image; PM2 + docker CLI gerekli çünkü bare-metal tasarım — burada **karar**: containerize mi, bare-metal install.sh mi? Mevcut mimari bare-metal. Dockerfile'ı **CI build verification + opsiyonel** için tut, üretim install.sh).
- `docker-compose.yml` — geliştirme ortamı (server + web + sqlite volume).

---

## Uygulama Sırası & Commit Stratejisi

Her faz kendi içinde mantıklı commit'lere bölünür:

1. **Faz 0** → 1-2 commit (CI altyapısı)
2. **Faz 1** → ~6 commit (exec, docker builder, pm2 builder, pipeline, worker recovery, proxy + testler) — **en kritik**
3. **Faz 2** → ~5 commit (rate-limit, RBAC, JWT, secret masking, zod)
4. **Faz 3** → ~2 commit (schema fix+indexes, token version)
5. **Faz 4** → ~4 commit (integration, web, cli, cleanup)

Her commit'ten sonra: `pnpm typecheck && pnpm test` yeşil olmalı (Faz 0 sonrası CI da).

## Başlangıç noktası
**Faz 1.1 (exec.ts timeout + env izolasyonu)** ile başlayacağım — çünkü Faz 1'in geri kalanı (pipeline, builders) bu sağlam exec temeline dayanıyor, ve şu anki en büyük operasyonel risk (takılı komut tüm kuyruğu kilitliyor).

## Not / Riskler
- **PM2 port çakışması** blue-green'i engeller: member seçimi (auto-rollback) bu nedenle doğru. Docker blue-green tam çalışır çünkü iki container farklı isimlerde aynı anda yaşayabilir ve routing container-adına göre flip eder.
- **Ownership modeli** (member sadece kendi servisleri) şemada `owner_id` gerektirir; Faz 2'de RBAC admin-only yıkıcı ile başlıyoruz, ownership Faz 3+'e ertelendi (gerekirse).
- **testcontainers** integration testleri CI'da yavaş; env flag ile opsiyonel yapılacak.