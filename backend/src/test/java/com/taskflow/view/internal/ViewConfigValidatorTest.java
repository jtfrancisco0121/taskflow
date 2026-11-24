package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("VIEW config validation of custom field columns (AD-8)")
class ViewConfigValidatorTest {

  private static ViewConfig columns(String... fields) {
    return new ViewConfig(
        1,
        null,
        null,
        null,
        java.util.Arrays.stream(fields).map(f -> new ViewConfig.Column(f, null)).toList(),
        null);
  }

  @Test
  void aCustomFieldColumnIsAccepted() {
    ViewConfigValidator.validate(columns("title", "cf:" + UUID.randomUUID()));
  }

  @Test
  void aMalformedCustomFieldColumnIsRefused() {
    for (String bad : List.of("cf:", "cf:nope", "cf:" + UUID.randomUUID() + ":x", "custom")) {
      assertThatThrownBy(() -> ViewConfigValidator.validate(columns("title", bad)))
          .isInstanceOf(TaskflowException.class)
          .extracting(e -> ((TaskflowException) e).code())
          .isEqualTo("view.invalid_config");
    }
    assertThat(ViewConfigValidator.customReference("cf:" + UUID.randomUUID())).isTrue();
    assertThat(ViewConfigValidator.customReference(null)).isFalse();
  }
}
