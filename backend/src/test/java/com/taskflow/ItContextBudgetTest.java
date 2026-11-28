package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.core.type.filter.RegexPatternTypeFilter;
import org.springframework.test.context.BootstrapUtils;
import org.springframework.test.context.MergedContextConfiguration;

/**
 * ClickUp 14yq6g334t6: every distinct Spring test context starts its own Testcontainers (Postgres,
 * Redis, RabbitMQ, Mailpit); 16 Postgres cold starts per run were 16 chances for the startup flake,
 * and one failed context fails every class that shares it. Integration tests reuse a few shared
 * setups instead ({@link IntegrationTest}, {@link WorkersIntegrationTest}, the outbox relay one).
 *
 * <p>This counts the contexts the way Spring caches them (one per distinct {@link
 * MergedContextConfiguration}). A new {@code @TestPropertySource}, {@code @MockitoSpyBean} field or
 * {@code @Import} on an IT makes a new context: reuse a shared setup, or raise {@link #BUDGET} on
 * purpose with the reason in the commit.
 */
@DisplayName("Integration test context budget")
class ItContextBudgetTest {

  /** 17 before ClickUp 14yq6g334t6. */
  static final int BUDGET = 12;

  @Test
  void integrationTestsShareAtMostTheBudgetedNumberOfContexts() throws Exception {
    Map<MergedContextConfiguration, TreeSet<String>> contexts = new java.util.HashMap<>();
    for (Class<?> it : integrationTests()) {
      MergedContextConfiguration key =
          BootstrapUtils.resolveTestContextBootstrapper(it).buildMergedContextConfiguration();
      contexts.computeIfAbsent(key, k -> new TreeSet<>()).add(it.getSimpleName());
    }
    String report =
        contexts.values().stream()
            .map(names -> names.size() + ": " + names)
            .sorted()
            .collect(Collectors.joining("\n"));

    assertThat(contexts).as("ITs found").isNotEmpty();
    assertThat(contexts.size()).as("distinct IT contexts:\n" + report).isLessThanOrEqualTo(BUDGET);
  }

  private static Iterable<Class<?>> integrationTests() throws ClassNotFoundException {
    ClassPathScanningCandidateComponentProvider scanner =
        new ClassPathScanningCandidateComponentProvider(false) {
          @Override
          protected boolean isCandidateComponent(
              org.springframework.beans.factory.annotation.AnnotatedBeanDefinition definition) {
            return definition.getMetadata().isConcrete()
                && definition.getMetadata().isIndependent();
          }
        };
    scanner.addIncludeFilter(new RegexPatternTypeFilter(java.util.regex.Pattern.compile(".*IT")));
    Map<String, Class<?>> found = new TreeMap<>();
    for (BeanDefinition definition : scanner.findCandidateComponents("com.taskflow")) {
      Class<?> type = Class.forName(definition.getBeanClassName());
      if (MergedAnnotations.from(type, MergedAnnotations.SearchStrategy.TYPE_HIERARCHY)
          .isPresent(SpringBootTest.class)) {
        found.put(type.getName(), type);
      }
    }
    return found.values();
  }
}
