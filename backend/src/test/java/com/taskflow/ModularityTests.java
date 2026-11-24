package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModule;
import org.springframework.modulith.core.ApplicationModules;

class ModularityTests {

  private static final List<String> EXPECTED =
      List.of(
          "automation",
          "doc",
          "field",
          "identity",
          "notification",
          "realtime",
          "shared",
          "task",
          "timetracking",
          "view",
          "workspace");

  @Test
  void modulesAreExactlyTheElevenFromTheArchitecture() {
    ApplicationModules modules = ApplicationModules.of(TaskflowApplication.class);
    assertThat(modules.stream().map(ApplicationModule::getIdentifier).map(Object::toString))
        .containsExactlyInAnyOrderElementsOf(EXPECTED);
  }

  @Test
  void moduleBoundariesAreRespected() {
    ApplicationModules.of(TaskflowApplication.class).verify();
  }
}
