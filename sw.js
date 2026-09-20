/* Service worker do Village Market.
   Objetivo: o app abrir mesmo com internet ruim no hall do prédio.
   Regras:
     - só cuida de arquivos do próprio site (nunca do Supabase nem de CDN)
     - navegação: tenta a rede, cai no cache, por último mostra o index
     - se o app mudou de endereço (a rede responde com redirecionamento),
       entrega o redirecionamento ao navegador e se desinstala daqui
     - arquivos: tenta a rede e guarda cópia; sem rede, usa o cache
   Nunca devolve HTML no lugar de um .js ou .css. */

/* Vários sites do Lucas dividem o domínio souza1010.github.io — e, com ele,
   o mesmo espaço de caches do navegador. Por isso o nome do cache carrega o
   caminho onde este app está publicado: ele só lê e só apaga o que é dele. */
var ESCOPO = self.registration.scope;
var PREFIXO = "village360:" + new URL(ESCOPO).pathname + ":";
var CACHE = PREFIXO + "v7";

/* Só entra aqui o que o montar.py realmente publica.
   O JavaScript das telas NÃO aparece nesta lista: ele vai embutido
   dentro de cada HTML, não existe como arquivo separado no ar.
   O montar.py confere esta lista a cada build e para se algo não existir. */
var BASE = [
  "./",
  "index.html",
  "app.html",
  "painel.html",
  "privacidade.html",
  "estilo.css",
  "config.js",
  "manifest.webmanifest",
  "icone.svg",
  "icone-192.png",
  "icone-512.png"
];

/* Uma cópia por arquivo, sem o que vem depois do "?".
   app.html?c=aurora e app.html?c=demo são o mesmo arquivo. */
function chave(url) { return url.origin + url.pathname; }

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        // um a um, de propósito: se um arquivo falhar, os outros continuam
        // guardados. Com addAll, um só erro descarta a lista inteira em silêncio.
        return Promise.all(BASE.map(function (arq) {
          // cache: "reload" — vai ao servidor e ignora a cópia que o navegador
          // guarda por até 10 minutos (max-age do GitHub Pages). Sem isso, logo
          // depois de um deploy o cache novo nascia com arquivos da versão velha.
          return c.add(new Request(arq, { cache: "reload" })).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

/* Até a v4 o cache se chamava "village-market-vN", sem o caminho — um nome
   que outro projeto no mesmo domínio também poderia usar. Um cache com esse
   nome só é apagado se tiver conteúdo e TODO ele for deste app. */
function apagarSeForDesteApp(nome) {
  return caches.open(nome)
    .then(function (c) { return c.keys(); })
    .then(function (reqs) {
      var desteApp = reqs.length > 0 && reqs.every(function (r) {
        return r.url.indexOf(ESCOPO) === 0;
      });
      return desteApp ? caches.delete(nome) : null;
    });
}

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        if (n === CACHE) return null;
        if (n.indexOf(PREFIXO) === 0) return caches.delete(n);            // versão anterior deste app
        if (/^village-market-v\d+$/.test(n)) return apagarSeForDesteApp(n); // nome usado até a v4
        return null;                                                      // de outro projeto: não mexe
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* O app mudou de endereço (domínio próprio): o endereço antigo passou a
   responder com redirecionamento. Aqui não há mais nada para servir —
   apaga o cache deste app e sai. No endereço novo, a página instala o
   service worker de lá, do zero. Se um dia isso disparar sem mudança de
   endereço, o custo é só reinstalar: a página registra o sw.js de novo. */
function desinstalar() {
  return caches.keys()
    .then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        return n.indexOf(PREFIXO) === 0 ? caches.delete(n) : null;
      }));
    })
    .then(function () { return self.registration.unregister(); });
}

/* Procura só no cache deste app — nunca no de outro projeto do domínio. */
function doCache(k) {
  return caches.open(CACHE).then(function (c) { return c.match(k); });
}

function guardar(k, res) {
  var copia = res.clone();
  caches.open(CACHE).then(function (c) { c.put(k, copia); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Supabase, fontes, CDN: deixa passar direto, sem cache e sem fallback.
  if (url.origin !== self.location.origin) return;

  var k = chave(url);
  var navegacao = req.mode === "navigate" ||
    (req.headers.get("accept") || "").indexOf("text/html") > -1;

  // cache: "no-cache" — confere com o servidor antes de usar a cópia do
  // navegador (se nada mudou, a resposta é um 304 rápido). Assim, depois de
  // um deploy, ninguém recebe página nova com CSS velho, e o cache deste app
  // nunca é regravado com uma cópia velha.
  //
  // redirect: "manual" — se o servidor mandar para outro endereço, o
  // service worker NÃO segue sozinho: devolve o redirecionamento para o
  // navegador, que leva o morador ao endereço novo. Seguindo sozinho (como
  // a v5), a resposta vinda de outro endereço é recusada pelo navegador e a
  // página não abre.
  if (navegacao) {
    e.respondWith(
      fetch(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
        .then(function (res) {
          if (res.type === "opaqueredirect") {
            // só uma navegação de verdade pode devolver o redirecionamento
            // ao navegador; um fetch de HTML feito pela página segue normal
            if (req.mode !== "navigate") return fetch(req.url, { credentials: "same-origin" });
            e.waitUntil(desinstalar());
            return res;
          }
          // só guarda resposta boa: como a chave é uma só para todos os
          // condomínios, uma página de erro guardada valeria para todos
          if (res && res.ok) guardar(k, res);
          return res;
        })
        .catch(function () {
          // Sem internet: app.html?c=aurora é encontrado como app.html.
          return doCache(k).then(function (hit) {
            return hit || doCache(new URL("index.html", ESCOPO).href);
          });
        })
    );
    return;
  }

  // demais arquivos do site: rede primeiro, cache como rede de segurança.
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then(function (res) {
        if (res && res.status === 200 && res.type === "basic") guardar(k, res);
        return res;
      })
      .catch(function () {
        // sem rede: devolve o cache. Se não houver, falha de verdade —
        // melhor um erro honesto do que HTML fingindo ser JavaScript.
        return doCache(k);
      })
  );
});
