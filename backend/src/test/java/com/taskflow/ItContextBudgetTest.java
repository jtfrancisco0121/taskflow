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
 * MergedContextConfiguration}), over every top-level test class (named like surefire's or
 * failsafe's includes: *IT, *Test, *Tests) with {@code @SpringBootTest} in its hierarchy. A new
 * {@code @TestPropertySource}, {@code @MockitoSpyBean} or {@code @MockitoBean} field or
 * {@code @Import} on an IT makes a new context: reuse a shared setup, or raise {@link #BUDGET} on
 * purpose with the IT and its reason in the list below. Such a class must also be named *IT, so it
 * runs in failsafe's integration phase with the containers, never in the surefire unit phase.
 */
@DisplayName("Integration test context budget")
class ItContextBudgetTest {

  /**
   * 17 before ClickUp 14yq6g334t6; 13 since epic 14yq6g334tf (sign-out revocation added two).
   *
   * <p>Three shared contexts ({@link IntegrationTest}, {@link WorkersIntegrationTest}, the outbox
   * relay one), plus one each for an IT that needs a setting no shared one can carry:
   *
   * <ul>
   *   <li>AmqpOutboxOutageIT: AMQP outbox with a simulated broker outage.
   *   <li>AmqpOutboxRelayIT: AMQP outbox relay on.
   *   <li>ApiKeyRateLimitIT: a tiny default API-key rate-limit plan (5).
   *   <li>AutomationDlqIT: workers plus AMQP with failing commands, to reach the DLQ.
   *   <li>NotificationStompIT: workers, outbox and AMQP all on, end to end to STOMP.
   *   <li>PresenceIT: short presence TTL and sweep.
   *   <li>RefreshGraceDisabledIT: refresh-token reuse grace set to zero.
   *   <li>SignInRateLimitBehindProxyIT: loopback as a trusted proxy.
   *   <li>SignOutErrorDispatchIT: {@code @MockitoBean AuthService} to force sign-out errors.
   *   <li>StompSecurityIT: short STOMP session sweep.
   * </ul>
   *
   * Raising this is a deliberate choice: add the new IT and its reason to this list.
   */
  static final int BUDGET = 13;

  @Test
  void springBootTestsAreNamedItSoFailsafeRunsThem() throws Exception {
    assertThat(misnamed(integrationTests()))
        .as(
            "@SpringBootTest classes not named *IT (surefire would start containers in the unit phase)")
        .isEmpty();
  }

  @Test
  void aSpringBootTestNamedLikeAUnitTestIsCaught() {
    assertThat(misnamed(java.util.List.of(MisnamedContextTest.class, NamedRightIT.class)))
        .containsExactly("MisnamedContextTest");
  }

  /** Fixtures for the check above; nested, so neither surefire nor failsafe runs them. */
  @SpringBootTest
  static class MisnamedContextTest {}

  @SpringBootTest
  static class NamedRightIT {}

  static java.util.List<String> misnamed(Iterable<Class<?>> springBootTests) {
    java.util.List<String> out = new java.util.ArrayList<>();
    for (Class<?> type : springBootTests) {
      if (!type.getSimpleName().endsWith("IT")) out.add(type.getSimpleName());
    }
    return out;
  }

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
                && definition.getMetadata().isIndependent()
                && !definition.getMetadata().hasEnclosingClass();
          }
        };
    scanner.addIncludeFilter(
        new RegexPatternTypeFilter(java.util.regex.Pattern.compile(".*(IT|Test|Tests)")));
    Map<String, Class<?>> found = new TreeMap<>();
    for (BeanDefinition definition : scanner.findCandidateComponents("com.taskflow")) {
      Class<?> type =
          Class.forName(
              definition.getBeanClassName(), false, ItContextBudgetTest.class.getClassLoader());
      if (MergedAnnotations.from(type, MergedAnnotations.SearchStrategy.TYPE_HIERARCHY)
          .isPresent(SpringBootTest.class)) {
        found.put(type.getName(), type);
      }
    }
    return found.values();
  }
}
