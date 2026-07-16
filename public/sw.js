/* =========================================================
   CanPredict AI Service Worker
   Version: 1.0
========================================================= */

const CACHE_NAME = "canpredict-ai-v1";

const STATIC_FILES = [
  "/",
  "/index.html",
  "/forecast.html",
  "/insights.html",
  "/profile.html",
  "/manifest.json",
  "/offline.html",
  "/styles.css",
  "/script.js",

  "/icon-192.png",
  "/icon-512.png"
];

/* ============================
   INSTALL
============================= */

self.addEventListener("install", (event) => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))

  );

  self.skipWaiting();

});

/* ============================
   ACTIVATE
============================= */

self.addEventListener("activate", (event) => {

  event.waitUntil(

    caches.keys().then((keys) =>

      Promise.all(

        keys.map((key) => {

          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }

        })

      )

    )

  );

  self.clients.claim();

});

/* ============================
   FETCH
============================= */

self.addEventListener("fetch", (event) => {

  if (event.request.method !== "GET") return;

  const request = event.request;
  const url = new URL(request.url);

  /* Never cache API calls — weather data must stay fresh. */
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  /* ---------- HTML Pages ----------
     Network First
  --------------------------------*/

  if (request.mode === "navigate") {

    event.respondWith(

      fetch(request)

        .then((response) => {

          const copy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });

          return response;

        })

        .catch(() => {

          return caches.match(request)

            .then((cached) => {

              return cached || caches.match("/offline.html");

            });

        })

    );

    return;

  }

  /* ---------- Static Assets ----------
     Cache First
  --------------------------------*/

  event.respondWith(

    caches.match(request)

      .then((cached) => {

        if (cached) {

          return cached;

        }

        return fetch(request)

          .then((response) => {

            if (
              !response ||
              response.status !== 200
            ) {
              return response;
            }

            const copy = response.clone();

            caches.open(CACHE_NAME)

              .then((cache) => {

                cache.put(request, copy);

              });

            return response;

          });

      })

  );

});

/* ============================
   PUSH
============================= */

self.addEventListener("push", (event) => {

  const options = {

    body: event.data ? event.data.text() : "New Notification",

    icon: "/icon-192.png",

    badge: "/icon-192.png"

  };

  event.waitUntil(

    self.registration.showNotification("CanPredict AI", options)

  );

});

/* ============================
   NOTIFICATION CLICK
============================= */

self.addEventListener("notificationclick", (event) => {

  event.notification.close();

  event.waitUntil(

    clients.openWindow("/")

  );

});
