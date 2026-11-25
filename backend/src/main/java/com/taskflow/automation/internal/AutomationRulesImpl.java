package com.taskflow.automation.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.automation.AutomationRules;
import com.taskflow.automation.RuleInfo;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class AutomationRulesImpl implements AutomationRules {

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  AutomationRulesImpl(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  @Override
  public Optional<RuleInfo> find(UUID ruleId) {
    return jdbc
        .query(
            "SELECT * FROM automation_rule WHERE id = ? AND deleted_at IS NULL",
            (rs, i) -> info(AutomationRuleService.row(rs)),
            ruleId)
        .stream()
        .findFirst();
  }

  @Override
  public List<RuleInfo> definedAt(UUID locationId) {
    return jdbc.query(
        "SELECT * FROM automation_rule WHERE location_id = ? AND deleted_at IS NULL ORDER BY"
            + " created_at, id",
        (rs, i) -> info(AutomationRuleService.row(rs)),
        locationId);
  }

  RuleInfo info(AutomationRuleService.Row r) {
    try {
      return new RuleInfo(
          r.id(),
          r.workspaceId(),
          r.locationId(),
          r.name(),
          r.enabled(),
          mapper.readTree(r.trigger()),
          mapper.readTree(r.conditions()),
          mapper.readTree(r.actions()),
          r.version(),
          r.createdBy());
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
