import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public final class BlueprintServer {
  static final int MAX_BODY = 16_000_000;

  public static void main(String[] args) throws Exception {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    String host = System.getenv().getOrDefault("BIND_HOST", "127.0.0.1");
    Path web = Path.of("web").toAbsolutePath().normalize();
    HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 32);
    server.setExecutor(Executors.newFixedThreadPool(6));
    server.createContext(
        "/api/",
        x -> {
          try {
            if (!Objects.equals(x.getRequestHeaders().getFirst("Host"), "localhost:" + port)
                && !Objects.equals(x.getRequestHeaders().getFirst("Host"), "127.0.0.1:" + port)
                && !host.equals("0.0.0.0")) {
              reply(x, 403, Map.of("error", "Invalid Host"));
              return;
            }
            String origin = x.getRequestHeaders().getFirst("Origin");
            if (origin != null
                && !origin.equals("http://localhost:" + port)
                && !origin.equals("http://127.0.0.1:" + port)) {
              reply(x, 403, Map.of("error", "Cross-origin requests forbidden"));
              return;
            }
            if (x.getRequestURI().getPath().equals("/api/health")) {
              reply(
                  x,
                  200,
                  Map.of(
                      "status",
                      "ok",
                      "java",
                      System.getProperty("java.version"),
                      "runner",
                      Runner.MODE));
              return;
            }
            if (StudioApi.read(x)) return;
            if (!x.getRequestMethod().equals("POST")) {
              reply(x, 405, Map.of("error", "POST required"));
              return;
            }
            if (!String.valueOf(x.getRequestHeaders().getFirst("Content-Type"))
                .startsWith("application/json")) {
              reply(x, 415, Map.of("error", "application/json required"));
              return;
            }
            byte[] raw = x.getRequestBody().readNBytes(MAX_BODY + 1);
            if (raw.length > MAX_BODY) throw new IllegalArgumentException("Request too large");
            Map<String, Object> r = Json.object(new String(raw, StandardCharsets.UTF_8));
            String route = x.getRequestURI().getPath();
            Object result;
            switch (route) {
              case "/api/analyze" -> {
                try (JavaModel m = new JavaModel(Json.str(r, "source", ""))) {
                  result = m.describe();
                }
              }
              case "/api/edit" -> {
                try (JavaModel m = new JavaModel(Json.str(r, "source", ""))) {
                  if (!m.valid()) throw new IllegalArgumentException("Fix syntax errors first");
                  String source = Transformations.edit(m, r);
                  try (JavaModel after = new JavaModel(source)) {
                    result = Map.of("source", source, "model", after.describe());
                  }
                }
              }
              case "/api/optimize" -> {
                try (JavaModel m = new JavaModel(Json.str(r, "source", ""))) {
                  if (!m.valid()) throw new IllegalArgumentException("Fix syntax errors first");
                  result = Transformations.optimize(m, Json.str(r, "methodId", ""));
                }
              }
              case "/api/extract" -> {
                var files = Runner.sources(r.get("files"));
                String name = Json.str(r, "fileName", "");
                if (!files.containsKey(name)) throw new IllegalArgumentException("Unknown file");
                try (JavaModel m = new JavaModel(files.get(name))) {
                  result =
                      Map.of(
                          "files",
                          Transformations.extract(m, Json.str(r, "methodId", ""), name, files));
                }
              }
              case "/api/decompose" -> {
                var files = Runner.sources(r.get("files"));
                String name = Json.str(r, "fileName", "");
                if (!files.containsKey(name)) throw new IllegalArgumentException("Unknown file");
                Object ids = r.get("methodIds");
                if (!(ids instanceof List<?> list) || list.isEmpty() || list.size() > 200)
                  throw new IllegalArgumentException("methodIds: 1..200 методов");
                try (JavaModel m = new JavaModel(files.get(name))) {
                  if (!m.valid()) throw new IllegalArgumentException("Fix syntax errors first");
                  result =
                      Transformations.decompose(
                          m,
                          list.stream().map(String::valueOf).toList(),
                          name,
                          Json.str(r, "className", ""),
                          files);
                }
              }
              case "/api/compile" ->
                  result =
                      Runner.withMain(
                          Json.str(r, "mainClass", ""),
                          () -> Runner.compileOnly(Runner.sources(r.get("files"))));
              case "/api/compare" -> {
                Object values = r.get("inputs");
                if (!(values instanceof List<?> inputs))
                  throw new IllegalArgumentException("inputs array required");
                result =
                    Runner.compare(
                        Runner.sources(r.get("original")),
                        Runner.sources(r.get("candidate")),
                        inputs.stream().map(String::valueOf).toList());
              }
              default -> {
                if (StudioApi.supports(route)) result = StudioApi.post(route, r);
                else {
                  reply(x, 404, Map.of("error", "Unknown API route"));
                  return;
                }
              }
            }
            reply(x, 200, result);
          } catch (IllegalArgumentException e) {
            reply(x, 400, Map.of("error", String.valueOf(e.getMessage())));
          } catch (Exception e) {
            e.printStackTrace();
            reply(
                x,
                500,
                Map.of(
                    "error", e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage())));
          } finally {
            x.close();
          }
        });
    server.createContext(
        "/",
        x -> {
          try {
            if (!x.getRequestMethod().equals("GET")) {
              x.sendResponseHeaders(405, -1);
              return;
            }
            String requested = x.getRequestURI().getPath();
            Path file =
                web.resolve(requested.equals("/") ? "index.html" : requested.substring(1))
                    .normalize();
            if (!file.startsWith(web) || !Files.isRegularFile(file)) {
              x.sendResponseHeaders(404, -1);
              return;
            }
            String ext = file.toString();
            String type =
                ext.endsWith(".html")
                    ? "text/html"
                    : ext.endsWith(".css")
                        ? "text/css"
                        : ext.endsWith(".js") || ext.endsWith(".mjs")
                            ? "text/javascript"
                            : ext.endsWith(".json")
                                ? "application/json"
                                : ext.endsWith(".svg")
                                    ? "image/svg+xml"
                                    : "application/octet-stream";
            byte[] body = Files.readAllBytes(file);
            x.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
            headers(x);
            x.sendResponseHeaders(200, body.length);
            x.getResponseBody().write(body);
          } finally {
            x.close();
          }
        });
    server.start();
    System.out.println("Java Blueprints: http://localhost:" + port + " | runner=" + Runner.MODE);
    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  StudioApi.JOBS.close();
                  server.stop(0);
                }));
  }

  static void headers(HttpExchange x) {
    x.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
    x.getResponseHeaders().set("Cache-Control", "no-store");
    x.getResponseHeaders()
        .set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src"
                + " 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none';"
                + " form-action 'none'");
  }

  static void reply(HttpExchange x, int code, Object value) throws IOException {
    byte[] b = Json.stringify(value).getBytes(StandardCharsets.UTF_8);
    headers(x);
    x.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    x.sendResponseHeaders(code, b.length);
    x.getResponseBody().write(b);
  }
}
