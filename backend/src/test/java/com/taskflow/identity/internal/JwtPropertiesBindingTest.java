package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

/**
 * ClickUp 14yq6g334r6 item 3: TASKFLOW_REFRESH_REUSE_GRACE=30 must mean 30 seconds, not 30 ms
 * (decision 010).
 */
@DisplayName("AUTH-2 refresh reuse grace binding")
class JwtPropertiesBindingTest {

  private static final String SECRET = "unit-test-secret-unit-test-secret-0123456789";

  private static Duration grace(String value) {
    Binder binder =
        new Binder(
            new MapConfigurationPropertySource(
                Map.of("taskflow.jwt.secret", SECRET, "taskflow.jwt.refresh-reuse-grace", value)));
    return binder.bind("taskflow.jwt", JwtProperties.class).get().refreshReuseGrace();
  }

  @Test
  void aBareNumberIsSeconds() {
    assertThat(grace("30")).isEqualTo(Duration.ofSeconds(30));
  }

  @Test
  void anIsoDurationStillBinds() {
    assertThat(grace("PT30S")).isEqualTo(Duration.ofSeconds(30));
  }

  @Test
  void anExplicitUnitStillWins() {
    assertThat(grace("500ms")).isEqualTo(Duration.ofMillis(500));
    assertThat(grace("0")).isEqualTo(Duration.ZERO);
  }
}
