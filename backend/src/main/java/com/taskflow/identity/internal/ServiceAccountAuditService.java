package com.taskflow.identity.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.ApiKeyDirectory;
import com.taskflow.shared.ActivityItem;
import com.taskflow.shared.ActivityQuery;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.Page;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** What an agent used and changed: calls per key and day, and its recent changes (KEY-6). */
@Service
class ServiceAccountAuditService {

  static final int DAYS = 30;

  record KeyAudit(UUID id, String name, String status, Instant lastUsedAt, long calls) {}

  record DayCalls(LocalDate day, long calls) {}

  /** {@code days} runs oldest to today (UTC), one entry per day, zero-filled. */
  record Audit(List<KeyAudit> keys, List<DayCalls> days, long totalCalls) {}

  /** One change; {@code entity} says what it touched (task, location, member, invite, ...). */
  record AccountActivity(
      UUID id,
      String entity,
      UUID entityId,
      String type,
      JsonNode payload,
      UUID actorKeyId,
      String actorKeyName,
      Instant createdAt) {}

  private final JdbcTemplate jdbc;
  private final ServiceAccountService accounts;
  private final ApiKeyService keys;
  private final ActivityQuery activity;
  private final ApiKeyDirectory keyNames;

  ServiceAccountAuditService(
      JdbcTemplate jdbc,
      ServiceAccountService accounts,
      ApiKeyService keys,
      ActivityQuery activity,
      ApiKeyDirectory keyNames) {
    this.jdbc = jdbc;
    this.accounts = accounts;
    this.keys = keys;
    this.activity = activity;
    this.keyNames = keyNames;
  }

  @Transactional(readOnly = true)
  Audit audit(UUID workspaceId, UUID accountId) {
    ServiceAccountService.requireHuman();
    accounts.require(workspaceId, accountId);
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    LocalDate first = today.minusDays(DAYS - 1);
    Map<LocalDate, Long> perDay = new HashMap<>();
    Map<UUID, Long> perKey = new HashMap<>();
    jdbc.query(
        "SELECT u.day, u.api_key_id, u.calls FROM api_key_usage_daily u JOIN api_key k ON k.id ="
            + " u.api_key_id WHERE k.service_account_id = ? AND u.day >= ?",
        rs -> {
          LocalDate day = rs.getObject("day", LocalDate.class);
          long calls = rs.getLong("calls");
          perDay.merge(day, calls, Long::sum);
          perKey.merge(rs.getObject("api_key_id", UUID.class), calls, Long::sum);
        },
        accountId,
        java.sql.Date.valueOf(first));
    List<DayCalls> days = new ArrayList<>();
    for (int i = 0; i < DAYS; i++) {
      LocalDate day = first.plusDays(i);
      days.add(new DayCalls(day, perDay.getOrDefault(day, 0L)));
    }
    List<KeyAudit> keyRows =
        keys.list(workspaceId, accountId).stream()
            .map(k ->
                new KeyAudit(
                    k.id(), k.name(), k.status(), k.lastUsedAt(), perKey.getOrDefault(k.id(), 0L)))
            .toList();
    return new Audit(keyRows, days, days.stream().mapToLong(DayCalls::calls).sum());
  }

  @Transactional(readOnly = true)
  Page<AccountActivity> activity(
      UUID workspaceId, UUID accountId, String cursor, Integer requestedLimit) {
    ServiceAccountService.requireHuman();
    accounts.require(workspaceId, accountId);
    Page<ActivityItem> page =
        activity.forActor(
            workspaceId, ActorType.SERVICE_ACCOUNT, accountId, cursor, requestedLimit);
    Map<UUID, String> names =
        keyNames.namesByIds(
            page.items().stream()
                .map(ActivityItem::actorKeyId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList());
    return new Page<>(
        page.items().stream()
            .map(i ->
                new AccountActivity(
                    i.id(),
                    i.entity(),
                    i.entityId(),
                    i.type(),
                    i.payload(),
                    i.actorKeyId(),
                    i.actorKeyId() == null ? null : names.get(i.actorKeyId()),
                    i.createdAt()))
            .toList(),
        page.nextCursor());
  }
}
