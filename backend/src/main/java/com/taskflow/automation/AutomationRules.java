package com.taskflow.automation;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Public read access to automation rules, for tests and other modules. No permission check. */
public interface AutomationRules {

  /** A live (not deleted) rule by id. */
  Optional<RuleInfo> find(UUID ruleId);

  /** The live rules defined at exactly this Location, oldest first. */
  List<RuleInfo> definedAt(UUID locationId);
}
