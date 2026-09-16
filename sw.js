/* Service worker do Village Market.
   Objetivo: o app abrir mesmo com internet ruim no hall do prédio.
   Regras:
     - só cuida de arquivos do próprio site (nunca do Supabase nem de CDN)
     - navegação: tenta a rede, cai no cache, por último mostra o index
     - arquivos: tenta a rede e guarda cópia; sem rede, usa o cache
   Nunca devolve HTML no lugar de um .js ou .css. */

var CACHE = "village-market-v3";
var BASE = [
  "./",
  "index.html",
  "app.html",
  "painel.html",
  "estilo.css",
  "app.js",
  "app-morador.js",
  "painel.js",
  "config.js",
  "manifest.webmanifest",
  "icone-192.png",
  "icone-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(BASE).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        return n === CACHE ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Supabase, fontes, CDN: deixa passar direto, sem cache e sem fallback.
  if (url.origin !== self.location.origin) return;

  var navegacao = req.mode === "navigate" ||
    (req.headers.get("accept") || "").indexOf("text/html") > -1;

  if (navegacao) {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("index.html");
          });
        })
    );
    return;
  }

  // demais arquivos do site: rede primeiro, cache como rede de segurança.
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      })
      .catch(function () {
        // sem rede: devolve o cache. Se não houver, falha de verdade —
        // melhor um erro honesto do que HTML fingindo ser JavaScript.
        return caches.match(req);
      })
  );
});
