package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * ClickUp 14yq6g334u1 guard: lock contention has one answer, 503 request.busy with Retry-After
 * ({@link LockContention#busy()}). No endpoint may answer contention with its own code (the retired
 * 409 code of the dependency endpoints, or any other {@code *.busy}). Runs from {@code backend/}.
 */
@DisplayName("Lock contention guard: one busy answer")
class LockContentionGuardTest {

  /** Built from parts so this file does not match itself. */
  private static final String RETIRED = "dependency" + ".busy";

  private static final Pattern BUSY_CODE = Pattern.compile("\"([a-z_]+)\\.busy\"");

  private static List<Path> files(Path root, String... extensions) {
    if (!Files.isDirectory(root)) {
      throw new IllegalStateException("missing source root " + root.toAbsolutePath());
    }
    try (Stream<Path> walk = Files.walk(root)) {
      return walk.filter(Files::isRegularFile)
          .filter(p ->
              p.getFileName().toString().matches(".*\\.(" + String.join("|", extensions) + ")"))
          .filter(p -> !p.toString().contains("node_modules"))
          .toList();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static String read(Path p) {
    try {
      return Files.readString(p, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Test
  void theRetiredDependencyBusyCodeIsGoneFromSourcesAndDocs() {
    List<Path> roots =
        List.of(Path.of("src"), Path.of("..", "frontend", "src"), Path.of("..", "docs"));
    List<String> hits = new ArrayList<>();
    for (Path root : roots) {
      for (Path p : files(root, "java", "ts", "tsx", "md", "json", "yaml", "yml", "sql")) {
        if (read(p).contains(RETIRED)) {
          hits.add(p.toString());
        }
      }
    }
    assertThat(hits).as("files naming " + RETIRED).isEmpty();
  }

  @Test
  void theOnlyBusyCodeInTheBackendIsRequestBusy() {
    List<String> others = new ArrayList<>();
    for (Path p : files(Path.of("src", "main", "java"), "java")) {
      Matcher m = BUSY_CODE.matcher(read(p));
      while (m.find()) {
        if (!"request".equals(m.group(1))) {
          others.add(p + ": " + m.group());
        }
      }
    }
    assertThat(others).as("busy codes other than request.busy").isEmpty();
  }

  /** Negative: the scan does see a busy code that is not request.busy. */
  @Test
  void thePatternCatchesAnyOtherBusyCode() {
    Matcher m = BUSY_CODE.matcher("TaskflowException.conflict(\"" + RETIRED + "\", \"x\")");
    assertThat(m.find()).isTrue();
    assertThat(m.group(1)).isEqualTo("dependency");
  }
}
