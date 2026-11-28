package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.TaskflowException;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR #34 review (ClickUp 14yq6g334r6 slice 2): at expires_at == now() a token is expired
 * everywhere, so presenting it and the grace check's "is the successor live" agree. The refresh
 * joins an outer transaction, so its now() is exactly the now() the token's expiry was set to.
 */
@DisplayName("AUTH-2 refresh expiry boundary")
class RefreshExpiryBoundaryIT extends IntegrationTest {

  @Autowired private AuthService auth;
  @Autowired private PlatformTransactionManager transactions;

  private String signUpCookie() {
    return AuthIT.refreshCookie(
        post(
            "/api/v1/auth/signup",
            null,
            Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Edge")));
  }

  private static String raw(String cookie) {
    return cookie.substring("refresh_token=".length());
  }

  /**
   * Sets the token's expires_at to now() and refreshes with it in the same transaction (rolled
   * back); returns what the refresh threw and the family's live token count seen inside.
   */
  private Object[] refreshAtExpiry(String raw) {
    return new TransactionTemplate(transactions)
        .execute(status -> {
          status.setRollbackOnly();
          jdbc.update(
              "UPDATE refresh_token SET expires_at = now() WHERE token_hash = ?",
              AuthService.sha256(raw));
          Throwable thrown = catchThrowable(() -> auth.refresh(raw));
          Integer live =
              jdbc.queryForObject(
                  "SELECT count(*) FROM refresh_token WHERE revoked_at IS NULL AND family_id ="
                      + " (SELECT family_id FROM refresh_token WHERE token_hash = ?)",
                  Integer.class,
                  AuthService.sha256(raw));
          return new Object[] {thrown, live};
        });
  }

  private static void assertUnauthorized(Object thrown) {
    assertThat(thrown)
        .isInstanceOfSatisfying(
            TaskflowException.class,
            e -> assertThat(e.status()).isEqualTo(HttpStatus.UNAUTHORIZED));
  }

  @Test
  void anUnrotatedTokenPresentedAtTheExactInstantItExpiresIsRefused() {
    String raw = raw(signUpCookie());

    Object[] result = refreshAtExpiry(raw);

    assertUnauthorized(result[0]);
  }

  /** The rotated token's own expiry check (expired) now agrees with the successor's (live). */
  @Test
  void aRotatedTokenReplayedAtTheExactInstantItExpiresGetsNoGraceAndRevokesTheFamily() {
    String a = signUpCookie();
    Resp rotated = post("/api/v1/auth/refresh", null, null, "Cookie", a);
    assertThat(rotated.status()).isEqualTo(200);

    Object[] result = refreshAtExpiry(raw(a));

    assertUnauthorized(result[0]);
    assertThat(result[1]).isEqualTo(0);
  }
}
