// Game version shown in the title and pause menus (see README: "Publicar uma nova versão").
// VERSION is also the cache key: index.html repeats it in its loader script, which adds ?v=VERSION
// to main.js and, through a generated import map, to every module import. Keep both in sync.
export const VERSION = '1.1.3';
export const DATE = '2026-10-04';
// short hash of the commit with this release's changes (a commit cannot contain its own hash,
// so it is filled in by a small follow-up commit)
export const COMMIT = '62721a5';
// cache key for models/ (json + webp textures): bump only when a file there changes
export const MODELS_REV = '13';

export const versionLabel = () => ['v' + VERSION, DATE, COMMIT].filter(Boolean).join(' · ');
