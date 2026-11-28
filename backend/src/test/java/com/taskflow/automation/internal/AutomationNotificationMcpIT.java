package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.identity.internal.McpTestBase;
import com.taskflow.notification.internal.WorkersIntegrationTest;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("CAP-14 MCP tools for automations and the owner's inbox")
@WorkersIntegrationTest
class AutomationNotificationMcpIT extends McpTestBase {

  private Map<String, Object> ruleArgs(UUID location, String name, String key) {
    Map<String, Object> args = new java.util.LinkedHashMap<>();
    args.put("locationId", location.toString());
    args.put("name", name);
    args.put("trigger", Map.of("type", "STATUS_CHANGED", "toStatuses", List.of("complete")));
    args.put("actions", List.of(Map.of("type", "ADD_COMMENT", "text", "done")));
    if (key != null) {
      args.put("idempotencyKey", key);
    }
    return args;
  }

  @Test
  void anAgentCreatesListsAndTogglesRulesAttributedToItsServiceAccountAndKey() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    Agent agent = agent(ws.admin(), ws.id(), "rules-agent", "CI-1");
    String key = "k-" + UUID.randomUUID();

    ToolResult created =
        call(agent.secret(), "create_automation", ruleArgs(space, "Done notes", key));
    assertThat(created.isError()).as(created.body().toString()).isFalse();
    UUID id = UUID.fromString(created.body().get("id").asText());
    // a replay with the same key returns the first rule and creates no second
    ToolResult replay =
        call(agent.secret(), "create_automation", ruleArgs(space, "Done notes", key));
    assertThat(replay.body().get("id").asText()).isEqualTo(id.toString());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM automation_rule WHERE location_id = ?", Long.class, space))
        .isEqualTo(1);

    ToolResult listed =
        call(agent.secret(), "list_automations", Map.of("locationId", space.toString()));
    assertThat(listed.body().at("/rules")).hasSize(1);
    assertThat(listed.body().at("/rules/0/enabled").asBoolean()).isTrue();

    ToolResult off =
        call(
            agent.secret(),
            "toggle_automation",
            Map.of("automationId", id.toString(), "enabled", false));
    assertThat(off.isError()).as(off.body().toString()).isFalse();
    assertThat(off.body().get("enabled").asBoolean()).isFalse();

    // the activity names the service account and its key
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT actor_type, actor_id, actor_key_id FROM activity_event WHERE entity_id = ? AND"
                + " type = 'automation.created'",
            id);
    assertThat(row.get("actor_type")).isEqualTo("SERVICE_ACCOUNT");
    assertThat(row.get("actor_id")).isEqualTo(agent.id());
    assertThat(row.get("actor_key_id")).isEqualTo(agent.keyId());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type ="
                    + " 'automation.disabled' AND actor_id = ?",
                Long.class,
                id,
                agent.id()))
        .isEqualTo(1);

    ToolResult bad =
        call(
            agent.secret(),
            "create_automation",
            Map.of(
                "locationId",
                space.toString(),
                "name",
                "x",
                "trigger",
                Map.of("type", "NOPE"),
                "actions",
                List.of()));
    assertThat(bad.isError()).isTrue();
    assertThat(bad.body().get("code").asText()).isEqualTo("automation.invalid_trigger");
  }

  @Test
  void anAgentReadsAndMarksTheOwnersInbox() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    Agent agent = agent(ws.admin(), ws.id(), "inbox-agent", "CI-1");
    // the owner of the service account is the admin who created it
    post(
        "/api/v1/lists/" + list + "/tasks",
        ws.owner().token(),
        Map.of("title", "Mine", "assigneeIds", List.of(ws.admin().id())));
    Awaitility.await()
        .atMost(Duration.ofSeconds(20))
        .until(() ->
            call(agent.secret(), "list_notifications", Map.of("unread", true))
                    .body()
                    .at("/items")
                    .size()
                >= 1);

    ToolResult listed = call(agent.secret(), "list_notifications", Map.of("unread", true));
    assertThat(listed.body().at("/items/0/kind").asText()).isEqualTo("ASSIGNED");
    UUID id = UUID.fromString(listed.body().at("/items/0/id").asText());
    ToolResult marked =
        call(agent.secret(), "mark_notification_read", Map.of("notificationId", id.toString()));
    assertThat(marked.isError()).as(marked.body().toString()).isFalse();
    assertThat(
            call(agent.secret(), "list_notifications", Map.of("unread", true)).body().at("/items"))
        .isEmpty();
    // it really is the admin's inbox
    assertThat(
            get("/api/v1/workspaces/" + ws.id() + "/notifications/unread-count", ws.admin().token())
                .at("/count")
                .asLong())
        .isZero();
    // someone else's notification is not reachable
    assertThat(
            call(
                    agent.secret(),
                    "mark_notification_read",
                    Map.of("notificationId", UUID.randomUUID().toString()))
                .isError())
        .isTrue();
  }

  @Test
  void markNotificationReadNeverReachesTheOwnersNotificationsInAnotherWorkspace() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id(), "scoped-agent", "CI-2");
    Ws other = workspaceWithAllRoles();
    addMember(other.id(), ws.admin(), "MEMBER");
    UUID otherSpace = space(other.owner(), other.id(), "Eng");
    UUID otherList = list(other.owner(), otherSpace, "Backlog");
    UUID task =
        UUID.fromString(
            post(
                    "/api/v1/lists/" + otherList + "/tasks",
                    other.owner().token(),
                    Map.of("title", "T"))
                .at("/id")
                .asText());
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO notification (id, workspace_id, recipient_id, kind, task_id, source_event_id,"
            + " actor_type, actor_id) VALUES (?, ?, ?, 'ASSIGNED', ?, ?, 'USER', ?)",
        id,
        other.id(),
        ws.admin().id(),
        task,
        UUID.randomUUID(),
        other.owner().id());
    assertThat(
            call(agent.secret(), "mark_notification_read", Map.of("notificationId", id.toString()))
                .isError())
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT read_at IS NULL FROM notification WHERE id = ?", Boolean.class, id))
        .isTrue();
  }

  @Test
  void withNoOwnerOrANonMemberOwnerTheInboxToolsFailAndTouchNothing() {
    Ws ws = workspaceWithAllRoles();
    Agent noOwner = agent(ws.admin(), ws.id(), "orphan-1", "k");
    jdbc.update("UPDATE service_account SET created_by = NULL WHERE id = ?", noOwner.id());
    ToolResult none = call(noOwner.secret(), "list_notifications", Map.of());
    assertThat(none.isError()).isTrue();
    assertThat(none.body().get("code").asText()).isEqualTo("notification.no_owner");

    Agent leftOwner = agent(ws.admin(), ws.id(), "orphan-2", "k");
    jdbc.update(
        "DELETE FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
        ws.id(),
        ws.admin().id());
    ToolResult gone =
        call(
            leftOwner.secret(),
            "mark_notification_read",
            Map.of("notificationId", UUID.randomUUID().toString()));
    assertThat(gone.isError()).isTrue();
    assertThat(gone.body().get("code").asText()).isEqualTo("notification.no_owner");
  }

  @Test
  void aUserTokenIsRefusedOnMcp() {
    Ws ws = workspaceWithAllRoles();
    Resp r = rpc(ws.owner().token(), "tools/list", null);
    assertThat(r.status()).isIn(401, 403);
  }
}
