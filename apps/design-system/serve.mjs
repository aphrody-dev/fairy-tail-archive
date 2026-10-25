Bun.serve({
  hostname: "127.0.0.1",
  port: 4173,
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(
      "http://127.0.0.1:3000" +
        (url.pathname === "/experience" ? "/" : url.pathname) +
        url.search,
      302,
    );
  },
});
console.log(
  "Unified Fairy Tail experience: http://127.0.0.1:3000/ (4173 redirects)",
);
