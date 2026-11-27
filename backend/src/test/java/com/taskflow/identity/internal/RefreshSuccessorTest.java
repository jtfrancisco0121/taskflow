package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HexFormat;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Decision 010 refresh successor derivation")
class RefreshSuccessorTest {

  private static final String SECRET = "unit-test-secret-unit-test-secret-0123456789";

  private static RefreshSuccessor successor(String secret) {
    return new RefreshSuccessor(
        new JwtProperties(
            secret, Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofSeconds(30)));
  }

  @Test
  void hkdfMatchesRfc5869TestCase1() {
    HexFormat hex = HexFormat.of();
    byte[] okm =
        RefreshSuccessor.hkdf(
            hex.parseHex("000102030405060708090a0b0c"),
            hex.parseHex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
            hex.parseHex("f0f1f2f3f4f5f6f7f8f9"),
            42);
    assertThat(hex.formatHex(okm))
        .isEqualTo(
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
  }

  @Test
  void theDerivedKeyIsNotTheJwtSigningKey() {
    byte[] key = successor(SECRET).keyForTests();
    byte[] signing = SECRET.getBytes(StandardCharsets.UTF_8);
    assertThat(key).hasSize(32).isNotEqualTo(signing);
    assertThat(key).isNotEqualTo(java.util.Arrays.copyOf(signing, 32));
    assertThat(key)
        .isEqualTo(
            RefreshSuccessor.hkdf(
                new byte[0], signing, "taskflow-refresh-successor-v1".getBytes(), 32));
    assertThat(key)
        .isNotEqualTo(RefreshSuccessor.hkdf(new byte[0], signing, "another-label".getBytes(), 32));
  }

  @Test
  void theSuccessorIsDeterministicAndDependsOnTokenAndSecret() {
    RefreshSuccessor one = successor(SECRET);
    String b = one.of("token-a");
    assertThat(b).isEqualTo(successor(SECRET).of("token-a"));
    assertThat(b).isNotEqualTo("token-a").isNotEqualTo(one.of("token-b"));
    assertThat(b).isNotEqualTo(successor(SECRET + "-other").of("token-a"));
    assertThat(b).matches("[A-Za-z0-9_-]{43}");
  }

  @Test
  void sameHashComparesWholeValuesWithMessageDigestIsEqual() {
    String h = AuthService.sha256("x");
    assertThat(RefreshSuccessor.sameHash(h, AuthService.sha256("x"))).isTrue();
    assertThat(RefreshSuccessor.sameHash(h, AuthService.sha256("y"))).isFalse();
    assertThat(RefreshSuccessor.sameHash(h, h.substring(0, 63))).isFalse();
    assertThat(RefreshSuccessor.sameHash(h, null)).isFalse();
    assertThat(RefreshSuccessor.sameHash(null, h)).isFalse();
  }
}
