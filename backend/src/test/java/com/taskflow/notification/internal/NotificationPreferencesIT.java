package com.taskflow.notification.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.taskflow.notification.DigestHook;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("CAP-13 preferences and the digest hook")
@WorkersIntegrationTest
class NotificationPreferencesIT extends NotificationSupport {

  /** The spy from {@link WorkersIntegrationTest}. */
  @Autowired DigestHook digest;

  private String path(UUID ws) {
    return "/api/v1/workspaces/" + ws + "/notification-preferences";
  }

  @Test
  void defaultsAreInAppForEveryKindAndDigestForAssignedAndMentionedOnly() {
    Fx f = fx();
    Resp r = get(path(f.ws().id()), f.ws().member().token());
    assertThat(r.status()).isEqualTo(200);
    assertThat(r.at("/kinds")).hasSize(7);
    for (var k : r.at("/kinds")) {
      assertThat(k.get("inApp").asBoolean()).isTrue();
      boolean digestKind =
          k.get("kind").asText().equals("ASSIGNED") || k.get("kind").asText().equals("MENTIONED");
      assertThat(k.get("emailDigest").asBoolean()).isEqualTo(digestKind);
    }
  }

  @Test
  void turningInAppOffStopsNewInboxEntriesOfThatKindForThatPersonOnly() {
    Fx f = fx();
    Resp put =
        put(
            path(f.ws().id()),
            f.ws().member().token(),
            Map.of(
                "kinds",
                List.of(Map.of("kind", "ASSIGNED", "inApp", false, "emailDigest", false))));
    assertThat(put.status()).isEqualTo(200);
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id(), f.ws().admin().id());
    awaitKind(f.ws().admin().id(), task, "ASSIGNED");
    pause(1000);
    assertThat(count(f.ws().member().id(), task, "ASSIGNED")).isZero();
    assertThat(get(path(f.ws().id()), f.ws().member().token()).at("/kinds/0/inApp").asBoolean())
        .isFalse();
  }

  @Test
  void preferencesArePerWorkspace() {
    Fx f = fx();
    put(
        path(f.ws().id()),
        f.ws().owner().token(),
        Map.of("kinds", List.of(Map.of("kind", "COMMENTED", "inApp", false, "emailDigest", true))));
    UUID other = createWorkspace(f.ws().owner(), "Other");
    for (var k : get(path(other), f.ws().owner().token()).at("/kinds")) {
      assertThat(k.get("inApp").asBoolean()).isTrue();
    }
    assertThat(
            put(
                    path(f.ws().id()),
                    f.ws().owner().token(),
                    Map.of(
                        "kinds",
                        List.of(Map.of("kind", "NOPE", "inApp", true, "emailDigest", true))))
                .status())
        .isEqualTo(400);
    assertThat(get(path(f.ws().id()), signUp("Stranger").token()).status()).isEqualTo(404);
  }

  @Test
  void withEmailDigestOnTheHookReceivesTheNotificationAndNoMailIsSent() throws Exception {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    verify(digest, timeout(5000))
        .accept(
            argThat((DigestHook.Entry e) ->
                e.recipientId().equals(f.ws().member().id())
                    && e.kind().equals("ASSIGNED")
                    && e.taskId().equals(task)));
    // the hook only logs: Mailpit received nothing for this person
    assertThat(mailpit().textsTo(f.ws().member().email(), 0)).isEmpty();
  }
}
