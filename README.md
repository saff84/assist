# AI Knowledge Assistant

AI Knowledge Assistant — это полнофункциональное RAG‑приложение для работы с техническими каталогами и инструкциями компании SANEXT. Репозиторий содержит фронтенд на Vite/React, backend на Express + tRPC, пайплайн обработки документов и инфраструктуру Docker Compose (MySQL + Weaviate + Ollama).

## Основные возможности
- Гибридный поиск (BM25 + эмбеддинги) с расширением контекста соседними чанками и фильтрацией по вариантам товара.
- Автоматическое форматирование таблиц/списков из ручной разметки, включая заголовки и структуры регионов.
- Отдельные UI для тестирования RAG (Test panel) и встроенный чат‑виджет.
- Bitrix24 webhook, импорт документов, генератор чанков из ручной разметки, Drizzle ORM + MySQL миграции.

## Технологии
- **Frontend:** React 19, Vite 7, Tailwind, Radix UI, react-markdown/remark-gfm.
- **Backend:** Node 20+, Express, tRPC, Drizzle ORM, Vitest.
- **LLM/RAG:** Ollama, bge‑m3 embeddings, опциональный reranker, настраиваемый `config/rag.json`.
- **Infra:** Docker Compose (MySQL, Weaviate, Ollama), pnpm, esbuild.

## Требования
- Node.js ≥ 20 и включённый `corepack` (для pnpm).
- Docker + Docker Compose (v2).
- Git LFS не требуется, но репозиторий содержит крупные PDF, поэтому убедитесь в достаточном дисковом пространстве.

## Структура репозитория
```
client/            # Vite + React frontend (src/components, pages, hooks, UI kit)
server/            # Express/tRPC backend, RAG компоненты, загрузка документов
drizzle/           # SQL миграции и схему БД
config/rag.json    # Основные настройки поиска и ограничений LLM
scripts/           # CLI-скрипты (debugRag.ts, regenerateAllEmbeddings.ts)
docker-compose.yml # Стек MySQL + Weaviate + Ollama + приложение
env.example        # Шаблон переменных окружения
```

## Настройка окружения
1. Скопируйте шаблон переменных и заполните значения:
   ```bash
   cp env.example .env
   ```
   Файл `env.example` содержит полный перечень переменных (БД, OAuth, Ollama, Bitrix24, настройки RAG).  
   > ⚠️ Платформа запрещает нам создавать файл `.env.example`, поэтому используется `env.example`. Просто переименуйте его локально перед запуском.

2. Установите зависимости:
   ```bash
   corepack enable
   corepack pnpm install
   ```

3. Запустите инфраструктуру Docker (по желанию) или используйте внешние сервисы, указав их в `.env`.

## Быстрый старт через Docker Compose
```bash
cp env.example .env            # заполните переменные
docker compose up -d --build   # запустит mysql, weaviate, ollama, приложение
```
- Приложение доступно на http://localhost:3000.
- Администратор создаётся автоматически:
  - Email: `admin@admin.local`
  - Пароль: `admin123`
- После первого входа смените пароль и `JWT_SECRET`.

### Сервисы
| Сервис | Назначение | Порты |
|--------|------------|-------|
| `mysql` | оперативная БД (Drizzle ORM) | 3306 |
| `weaviate` | векторная БД для RAG | 8080 |
| `ollama` | локальная LLM + embeddings | 11434 |
| `ollama-setup` | единоразовая загрузка моделей (`gemma2:2b`, `qwen2.5:3b`, `bge-m3`) | — |
| `app` | сервер + фронтенд | 3000 |

## Локальная разработка
1. `cp env.example .env` и заполните нужные переменные.
2. `corepack pnpm install`
3. В одном терминале: `corepack pnpm dev` — запускает backend (Express + tRPC).
4. В другом терминале: `corepack pnpm vite dev --host` — фронтенд Vite (порт 5173 по умолчанию).
5. Для типизации и тестов:
   ```bash
   corepack pnpm check   # tsc --noEmit
   corepack pnpm test    # Vitest
   corepack pnpm build   # Vite build + esbuild backend
   ```

## Переменные окружения (из `env.example`)
Ключевые параметры:
- **База данных:** `DATABASE_URL`, `MYSQL_*`.
- **Безопасность:** `JWT_SECRET`, `DEV_MODE`, `DEV_ADMIN_*`, `ADMIN_*`, `OWNER_OPEN_ID`.
- **OAuth/Manus:** `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID`.
- **LLM/RAG:** `OLLAMA_URL`, `OLLAMA_MODEL`, `EMBEDDING_MODEL`, `RERANKER_URL`, `LLM_TEMPERATURE`, `RAG_CONFIG_PATH`, `RAG_SYSTEM_PROMPT_PATH`.
- **Интеграции:** `BITRIX24_WEBHOOK_URL`, `BUILT_IN_FORGE_API_*`, `VITE_FRONTEND_FORGE_API_*`.

## Доступные npm-скрипты
| Команда | Описание |
|---------|----------|
| `pnpm dev` | Запуск backend (Node + tRPC) в режиме watch |
| `pnpm vite dev` | Фронтенд Dev Server |
| `pnpm build` | Сборка клиента и бандл backend (Vite + esbuild) |
| `pnpm start` | Запуск собранного приложения (`dist/index.js`) |
| `pnpm test` | Юнит‑тесты Vitest |
| `pnpm check` | Проверка типов TypeScript |
| `pnpm format` | Prettier форматирование |
| `pnpm db:push` | Генерация/применение миграций Drizzle |

## Безопасность и подготовка к продакшену
- Используйте уникальные значения `JWT_SECRET`, `ADMIN_PASSWORD`, `DEV_ADMIN_*`.
- Отключайте `DEV_MODE` в продакшене.
- Ограничьте сетевой доступ к MySQL/Weaviate/TCP‑портам Ollama.
- Настройте HTTPS и централизованные логи.
- Перегенерируйте эмбеддинги после каждой перезагрузки документов (`scripts/regenerateAllEmbeddings.ts`).

## Отладка и диагностика
- `scripts/debugRag.ts` помогает анализировать выбор чанков и выдачу.
- В UI доступна Test Panel с визуализацией этапов запроса (`Ищу информацию → Думаю → Печатаю`).
- Все исходные чанки/таблицы доступны в карточке ответа (в т.ч. `chunkContent`).

## Известные ограничения
- Для работы фронтенда требуется `VITE_*` переменные (заголовок, OAuth-портал, логотип). Они подставляются на этапе сборки.
- Docker Compose ожидает установленный `docker compose` v2; директива `version` удалена, чтобы избежать предупреждений.
- Скрипт `ollama-setup` использует переменную `$$model` (двойное `$`) — не изменяйте, иначе Compose будет пытаться подставить переменные окружения.

## Лицензия
Проект распространяется по лицензии MIT (см. `package.json`).

