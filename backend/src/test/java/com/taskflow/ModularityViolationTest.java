package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModule;
import org.springframework.modulith.core.ApplicationModules;
import org.springframework.modulith.core.Violations;

/** Proves the boundary check bites: module a reaches into b.internal. */
class ModularityViolationTest {

  @Test
  void fixtureViolationIsDetected() throws ClassNotFoundException {
    // Loaded by name: the fixture is compiled to target/modulith-fixture-classes (see pom.xml).
    Class<?> fixtureRoot = Class.forName("com.taskflowfixture.FixtureRoot");
    ApplicationModules modules = ApplicationModules.of(fixtureRoot);

    assertThat(modules.stream().map(ApplicationModule::getIdentifier).map(Object::toString))
        .containsExactlyInAnyOrder("a", "b");

    assertThatThrownBy(modules::verify)
        .isInstanceOf(Violations.class)
        .hasMessageContaining("b.internal.Secret");
  }
}
