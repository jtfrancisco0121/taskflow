package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.taskflow.shared.RateLimiter;
import com.taskflow.shared.TaskflowException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/**
 * Epic 14yq6g334tf: local e2e runs sign in many times from 127.0.0.1 and tripped the per-IP sign-in
 * limit ("Too many attempts"). Only the dev profile raises it; the production default stays 20 per
 * minute, and no other config file may set it.
 */
@DisplayName("AUTH-3 sign-in limit per IP: production default, dev profile only")
class SignInLimitsTest {

  private static final String KEY = "taskflow.auth.sign-in.ip-attempt-limit";

  private static List<PropertySource<?>> yaml(String name) throws IOException {
    return new YamlPropertySourceLoader().load(name, new ClassPathResource(name));
  }

  /** Binds like Spring does: later files win. */
  private static SignInLimits bind(String... files) throws IOException {
    MutablePropertySources sources = new MutablePropertySources();
    for (String file : files) {
      for (PropertySource<?> source : yaml(file)) sources.addFirst(source);
    }
    return new Binder(ConfigurationPropertySources.from(sources))
        .bindOrCreate("taskflow.auth.sign-in", SignInLimits.class);
  }

  @Test
  void theProductionDefaultIsTwentyAttemptsPerMinute() throws IOException {
    assertThat(bind("application.yml").ipAttemptLimit()).isEqualTo(20);
    assertThat(AuthService.IP_ATTEMPT_LIMIT).isEqualTo(20);
    assertThat(AuthService.IP_WINDOW).hasMinutes(1);
  }

  @Test
  void theDevProfileRaisesItForLocalE2eRuns() throws IOException {
    assertThat(bind("application.yml", "application-dev.yml").ipAttemptLimit())
        .isGreaterThanOrEqualTo(1000);
  }

  @Test
  void noConfigFileButTheDevProfileSetsIt() throws IOException {
    List<String> setters = new ArrayList<>();
    Resource[] files =
        new PathMatchingResourcePatternResolver()
            .getResources("classpath*:application*.{yml,yaml,properties}");
    assertThat(files).isNotEmpty();
    for (Resource file : files) {
      String text = file.getContentAsString(StandardCharsets.UTF_8);
      if (text.contains("ip-attempt-limit") || text.contains("ipAttemptLimit")) {
        setters.add(file.getFilename());
      }
    }
    assertThat(setters).containsExactly("application-dev.yml");
  }

  @Test
  void aLimitBelowOneIsRefused() {
    Binder binder = new Binder(new MapConfigurationPropertySource(Map.of(KEY, "0")));
    assertThatThrownBy(() -> binder.bind("taskflow.auth.sign-in", SignInLimits.class))
        .isInstanceOf(BindException.class);
  }

  @Test
  void signInCountsAgainstTheConfiguredLimit() {
    RateLimiter limiter = mock(RateLimiter.class);
    when(limiter.hit(anyString(), anyInt(), eq(AuthService.IP_WINDOW)))
        .thenReturn(new RateLimiter.Decision(false, 8, 30));
    AuthService auth = new AuthService(null, null, null, null, limiter, null, new SignInLimits(7));

    assertThatThrownBy(() -> auth.signIn("a@example.com", "pw", "10.0.0.1"))
        .isInstanceOf(TaskflowException.class);
    verify(limiter).hit("signin:ip:10.0.0.1", 7, AuthService.IP_WINDOW);
  }
}
