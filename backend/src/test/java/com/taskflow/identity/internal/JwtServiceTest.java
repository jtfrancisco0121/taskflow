package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;

@DisplayName("AUTH-2 access tokens")
class JwtServiceTest {

  private static final String SECRET = "unit-test-secret-unit-test-secret-0123456789";

  private JwtService service(String secret, Duration ttl) {
    return new JwtService(
        new JwtProperties(secret, ttl, Duration.ofDays(30), Duration.ofSeconds(30)));
  }

  @Test
  void issuesAHs256TokenWithSubjectAndEmail() {
    UUID id = UUID.randomUUID();
    JwtService service = service(SECRET, Duration.ofMinutes(15));
    Jwt jwt = service.decoder().decode(service.issue(id, "a@example.com"));
    assertThat(jwt.getSubject()).isEqualTo(id.toString());
    assertThat(jwt.<String>getClaim("email")).isEqualTo("a@example.com");
    assertThat(jwt.getHeaders().get("alg")).isEqualTo("HS256");
    assertThat(jwt.getExpiresAt()).isAfter(jwt.getIssuedAt());
    assertThat(service.expiresInSeconds()).isEqualTo(900);
  }

  @Test
  void rejectsATokenSignedWithAnotherSecret() {
    String token =
        service(SECRET, Duration.ofMinutes(15)).issue(UUID.randomUUID(), "a@example.com");
    JwtService other = service("another-secret-another-secret-0123456789", Duration.ofMinutes(15));
    assertThatThrownBy(() -> other.decoder().decode(token)).isInstanceOf(JwtException.class);
  }

  @Test
  void rejectsATamperedPayload() {
    JwtService service = service(SECRET, Duration.ofMinutes(15));
    String[] parts = service.issue(UUID.randomUUID(), "a@example.com").split("\\.");
    String forged =
        java.util.Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                "{\"sub\":\"00000000-0000-0000-0000-000000000001\",\"exp\":9999999999}"
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    String token = parts[0] + "." + forged + "." + parts[2];
    assertThatThrownBy(() -> service.decoder().decode(token)).isInstanceOf(JwtException.class);
  }

  @Test
  void refusesToStartWithAMissingOrShortSecret() {
    assertThatThrownBy(() ->
            new JwtProperties(
                "", Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofSeconds(30)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() ->
            new JwtProperties(
                "short", Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofSeconds(30)))
        .isInstanceOf(IllegalStateException.class);
  }
}
