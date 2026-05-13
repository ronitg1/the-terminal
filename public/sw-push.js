// Service worker for browser push notifications.
// Receives push events from the server, shows a notification, and routes
// clicks to the relevant tab in the app.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "The Terminal", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "The Terminal";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    data: { url: payload.url || "/", tag: payload.tag },
    tag: payload.tag,
    requireInteraction: payload.requireInteraction === true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const u = new URL(client.url);
        if (u.pathname === url || u.pathname.startsWith(url)) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
