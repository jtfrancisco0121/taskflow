package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.taskflow.IntegrationTest;
import com.taskflow.identity.UserDirectory;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

@DisplayName("SA-1 service accounts are app_user rows that no email lookup can reach")
class AppUserKindIT extends IntegrationTest {

  @Autowired UserDirectory users;

  private UUID serviceAccountRow() {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO app_user (id, kind, display_name) VALUES (?, 'SERVICE_ACCOUNT', 'bot')", id);
    return id;
  }

  @Test
  void aServiceAccountRowWithNoEmailIsAllowed() {
    UUID id = serviceAccountRow();
    assertThat(users.byId(id)).isPresent();
    assertThat(users.byId(id).orElseThrow().email()).isNull();
  }

  @Test
  void aHumanRowWithoutEmailOrPasswordViolatesTheCheck() {
    assertThatThrownBy(() ->
            jdbc.update(
                "INSERT INTO app_user (id, kind, display_name) VALUES (?, 'HUMAN', 'x')",
                UUID.randomUUID()))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void aServiceAccountIsNeverFoundByEmailAndCannotSignIn() {
    UUID id = serviceAccountRow();
    // Even a (never created by the app) email on such a row is invisible to the lookups.
    String email = "bot-" + id + "@example.com";
    jdbc.update("UPDATE app_user SET email = ?, password_hash = 'x' WHERE id = ?", email, id);
    assertThat(users.byEmail(email)).isEmpty();
    Resp r =
        post("/api/v1/auth/signin", null, Map.of("email", email, "password", "anything-at-all"));
    assertThat(r.status()).isEqualTo(401);
    assertThat(r.text("/code")).isEqualTo("auth.invalid_credentials");
  }
}
