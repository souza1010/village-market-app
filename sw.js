/* Service worker do Village Market.
   Objetivo: o app abrir mesmo com internet ruim no hall do prédio.
   Regras:
     - só cuida de arquivos do próprio site (nunca do Supabase nem de CDN)
     - navegação: tenta a rede, cai no cache, por último mostra o index
     - arquivos: tenta a rede e guarda cópia; sem rede, usa o cache
   Nunca devolve HTML no lugar de um .js ou .css. */

var CACHE = "village-market-v4";

/* Só entra aqui o que o montar.py realmente publica.
   O JavaScript das telas NÃO aparece nesta lista: ele vai embutido
   dentro de cada HTML, não existe como arquivo separado no ar.
   O montar.py confere esta lista a cada build e para se algo não existir. */
var BASE = [
  "./",
  "index.html",
  "app.html",
  "painel.html",
  "estilo.css",
  "config.js",
  "manifest.webmanifest",
  "icone.svg",
  "icone-192.png",
  "icone-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        // um a um, de propósito: se um arquivo falhar, os outros continuam
        // guardados. Com addAll, um só erro descarta a lista inteira em silêncio.
        return Promise.all(BASE.map(function (arq) {
          return c.add(arq).catch(function () {});
        }));
      })
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
          // Sem internet. O morador abre o link com o condomínio na URL
          // (app.html?c=aurora), mas o cache guardou "app.html" e mais nada.
          // ignoreSearch manda procurar pelo nome da página, deixando de
          // lado o que vem depois do "?" — assim vale para qualquer
          // condomínio, não só um. Sem isso, o app cairia na pesquisa.
          return caches.match(req, { ignoreSearch: true }).then(function (hit) {
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
