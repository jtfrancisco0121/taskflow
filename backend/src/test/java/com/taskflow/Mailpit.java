package com.taskflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Reads the mail catcher's HTTP API (axllent/mailpit). */
public final class Mailpit {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final HttpClient HTTP = HttpClient.newHttpClient();

  private final String api;

  public Mailpit(String api) {
    this.api = api;
  }

  /** The text bodies of the messages sent to the address, polling up to the timeout. */
  public List<String> textsTo(String address, long timeoutMillis) {
    long deadline = System.currentTimeMillis() + timeoutMillis;
    do {
      List<String> texts = fetch(address);
      if (!texts.isEmpty() || timeoutMillis == 0) {
        return texts;
      }
      sleep(200);
    } while (System.currentTimeMillis() < deadline);
    return fetch(address);
  }

  private List<String> fetch(String address) {
    try {
      String query = URLEncoder.encode("to:\"" + address + "\"", StandardCharsets.UTF_8);
      JsonNode search = json("/api/v1/search?query=" + query);
      List<String> texts = new ArrayList<>();
      for (JsonNode message : search.path("messages")) {
        texts.add(json("/api/v1/message/" + message.path("ID").asText()).path("Text").asText());
      }
      return texts;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private JsonNode json(String path) throws Exception {
    HttpResponse<String> response =
        HTTP.send(
            HttpRequest.newBuilder(URI.create(api + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString());
    return MAPPER.readTree(response.body());
  }

  private static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
