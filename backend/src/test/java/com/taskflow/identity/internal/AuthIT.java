package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

@DisplayName("AUTH-1 sign up, sign in and sign out")
class AuthIT extends IntegrationTest {

  static final String PASSWORD = "correct-horse-battery";

  static String email() {
    return "auth+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
  }

  static String refreshCookie(Resp response) {
    return response.headers().get("Set-Cookie").stream()
        .filter(c -> c.startsWith("refresh_token="))
        .findFirst()
        .map(c -> c.substring(0, c.indexOf(';')))
        .orElseThrow();
  }

  Resp signup(String email) {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", email, "password", PASSWORD, "displayName", "Ada"));
  }

  @Test
  void signUpReturnsATokenPairAndAHardenedCookie() {
    String email = email();
    Resp r = signup(email);
    assertThat(r.status()).isEqualTo(201);
    assertThat(r.text("/tokenType")).isEqualTo("Bearer");
    assertThat(r.at("/expiresIn").asLong()).isEqualTo(900);
    assertThat(r.text("/user/email")).isEqualTo(email);
    String cookie = r.headers().get("Set-Cookie").get(0);
    assertThat(cookie)
        .startsWith("refresh_token=")
        .contains("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/v1/auth");
    assertThat(r.raw())
        .doesNotContain("refreshToken")
        .doesNotContain(refreshCookie(r).substring(14));
  }

  @Test
  void thePasswordIsStoredOnlyAsABcryptHash() {
    String email = email();
    signup(email);
    String hash =
        jdbc.queryForObject(
            "SELECT password_hash FROM app_user WHERE email = ?", String.class, email);
    assertThat(hash).isNotEqualTo(PASSWORD).startsWith("$2");
    assertThat(new BCryptPasswordEncoder().matches(PASSWORD, hash)).isTrue();
  }

  @Test
  void signInWithTheRightPasswordWorksAndAWrongOneGives401Problem() {
    String email = email();
    signup(email);
    Resp ok =
        post(
            "/api/v1/auth/signin",
            null,
            Map.of("email", email.toUpperCase(), "password", PASSWORD));
    assertThat(ok.status()).isEqualTo(200);
    Resp me = get("/api/v1/me", ok.text("/accessToken"));
    assertThat(me.status()).isEqualTo(200);
    assertThat(me.text("/email")).isEqualTo(email);

    Resp wrong =
        post("/api/v1/auth/signin", null, Map.of("email", email, "password", "wrong-password-1"));
    assertThat(wrong.status()).isEqualTo(401);
    assertThat(
            wrong.headers().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .isTrue();
    assertThat(wrong.text("/code")).isEqualTo("auth.invalid_credentials");
  }

  @Test
  void anUnknownEmailLooksLikeAWrongPassword() {
    Resp r = post("/api/v1/auth/signin", null, Map.of("email", email(), "password", PASSWORD));
    assertThat(r.status()).isEqualTo(401);
    assertThat(r.text("/code")).isEqualTo("auth.invalid_credentials");
  }

  @Test
  void aDuplicateEmailIs409AndInvalidInputIs400WithErrors() {
    String email = email();
    assertThat(signup(email).status()).isEqualTo(201);
    Resp duplicate = signup(email.toUpperCase());
    assertThat(duplicate.status()).isEqualTo(409);
    assertThat(duplicate.text("/code")).isEqualTo("auth.email_taken");

    Resp invalid =
        post(
            "/api/v1/auth/signup",
            null,
            Map.of("email", "nope", "password", "short", "displayName", "x"));
    assertThat(invalid.status()).isEqualTo(400);
    assertThat(invalid.at("/errors").size()).isGreaterThanOrEqualTo(2);
  }

  @Test
  void signOutRevokesTheSession() {
    Resp up = signup(email());
    String cookie = refreshCookie(up);
    Resp out = post("/api/v1/auth/signout", null, null, "Cookie", cookie);
    assertThat(out.status()).isEqualTo(204);
    assertThat(out.headers().getFirst("Set-Cookie")).contains("Max-Age=0");
    Resp refresh = post("/api/v1/auth/refresh", null, null, "Cookie", cookie);
    assertThat(refresh.status()).isEqualTo(401);
  }

  @Test
  void protectedEndpointsNeedATokenButPublicOnesDoNot() {
    Resp noToken = get("/api/v1/me", null);
    assertThat(noToken.status()).isEqualTo(401);
    assertThat(
            noToken.headers().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .isTrue();
    assertThat(get("/api/v1/meta", null).status()).isEqualTo(200);
    assertThat(get("/v3/api-docs", null).status()).isEqualTo(200);
    assertThat(get("/actuator/health", null).status()).isEqualTo(200);
    assertThat(get("/swagger-ui/index.html", null).status()).isEqualTo(200);
    assertThat(get("/api/v1/me", "garbage").status()).isEqualTo(401);
  }
}
