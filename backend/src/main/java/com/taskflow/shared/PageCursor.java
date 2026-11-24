package com.taskflow.shared;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.springframework.http.HttpStatus;

/** Opaque base64url cursor over sort keys; never an offset. */
public final class PageCursor {

  public static final int DEFAULT_LIMIT = 50;
  public static final int MAX_LIMIT = 200;
  private static final char SEP = '\u001f';

  private PageCursor() {}

  public static int limit(Integer requested) {
    if (requested == null) {
      return DEFAULT_LIMIT;
    }
    if (requested < 1) {
      throw TaskflowException.badRequest("page.invalid_limit", "limit must be at least 1");
    }
    return Math.min(requested, MAX_LIMIT);
  }

  public static String encode(String... parts) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(String.join(String.valueOf(SEP), parts).getBytes(StandardCharsets.UTF_8));
  }

  /** Returns null for a null or empty cursor, the parts otherwise. */
  public static List<String> decode(String cursor, int expectedParts) {
    if (cursor == null || cursor.isBlank()) {
      return null;
    }
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      String[] parts = raw.split(String.valueOf(SEP), -1);
      if (parts.length != expectedParts) {
        throw new IllegalArgumentException("wrong part count");
      }
      return List.of(parts);
    } catch (IllegalArgumentException e) {
      throw new TaskflowException(HttpStatus.BAD_REQUEST, "page.invalid_cursor", "Invalid cursor");
    }
  }

  /** Builds a page from up to limit + 1 fetched rows. */
  public static <T> Page<T> page(
      List<T> fetched, int limit, java.util.function.Function<T, String> cursorOf) {
    if (fetched.size() > limit) {
      List<T> items = fetched.subList(0, limit);
      return new Page<>(items, cursorOf.apply(items.get(items.size() - 1)));
    }
    return new Page<>(fetched, null);
  }
}
